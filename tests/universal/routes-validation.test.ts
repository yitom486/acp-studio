// @vitest-environment node
/**
 * Hono 子路由 + 请求校验（routes.ts 拆分回归）：
 * 坏 JSON / 类型不对 → 400（不再静默当成 `{}` 继续）；空 body 仍等价 `{}`；
 * 未知路由 404、只读接口 405 等原有语义保持不变。
 */
import { describe, it, expect } from "vitest";
import * as os from "node:os";
import { handleUniversal } from "../../server/universal/routes";
import { authedRequest } from "../helpers/gateway-auth";

async function call(method: string, p: string, body?: string, contentType = "application/json") {
  const res = (await handleUniversal(
    authedRequest(`http://127.0.0.1:3004${p}`, {
      method,
      ...(body !== undefined ? { body, headers: { "Content-Type": contentType } } : {}),
    })
  ))!;
  return { status: res.status, body: (await res.json()) as { ok: boolean; error?: string } };
}

describe("malformed request bodies return 400", () => {
  const endpoints = [
    "/api/universal/terminal/exec",
    "/api/universal/workspace/validate",
    "/api/universal/git/stage",
    "/api/universal/permission/respond",
    "/api/universal/chat",
    "/api/universal/agents",
    "/api/universal/agents/codex/session/new",
  ];
  for (const p of endpoints) {
    it(`POST ${p} with broken JSON → 400`, async () => {
      const r = await call("POST", p, "{not json");
      expect(r.status).toBe(400);
      expect(r.body.ok).toBe(false);
      expect(r.body.error).toMatch(/invalid JSON body/);
    });
  }

  it("also when the client forgot the Content-Type header", async () => {
    const r = await call("POST", "/api/universal/terminal/exec", "{oops", "text/plain");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/invalid JSON body/);
  });

  it("wrong field types are rejected by the schema", async () => {
    const r = await call("POST", "/api/universal/terminal/exec", JSON.stringify({ cwd: 42, command: "echo x" }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/invalid request body/);
    expect(r.body.error).toContain("cwd");
    const r2 = await call("POST", "/api/universal/agents/codex/session/new", JSON.stringify({ additionalDirectories: "nope" }));
    expect(r2.status).toBe(400);
    expect(r2.body.error).toContain("additionalDirectories");
  });
});

describe("unchanged semantics", () => {
  it("empty body is still treated as {} (handler-level validation messages)", async () => {
    expect(await call("POST", "/api/universal/terminal/exec")).toEqual({
      status: 400,
      body: { ok: false, error: "command is required" },
    });
    expect((await call("POST", "/api/universal/workspace/validate")).body.error).toBe("路径不能为空");
    expect((await call("POST", "/api/universal/permission/respond")).body.error).toBe("agentId + permissionId required");
  });

  it("unknown routes and unknown session actions → 404 JSON", async () => {
    const r = await call("GET", "/api/universal/nope");
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("Unknown universal route GET /api/universal/nope");
    const a = await call("POST", "/api/universal/agents/codex/session/teleport", "{}");
    expect(a.status).toBe(404);
    const proto = await call("POST", "/api/universal/agents/codex/session/toString", "{}");
    expect(proto.status).toBe(404);
  });

  it("read-only git endpoints answer 405 to other methods", async () => {
    const r = await call("POST", `/api/universal/git/status?cwd=${encodeURIComponent(os.tmpdir())}`, "{}");
    expect(r.status).toBe(405);
  });

  it("agents list and workspace default still work", async () => {
    const agents = await call("GET", "/api/universal/agents");
    expect(agents.status).toBe(200);
    expect(agents.body.ok).toBe(true);
    const ws = await call("GET", "/api/universal/workspace/default");
    expect(ws.status).toBe(200);
  });

  it("non-universal paths are not handled (gateway falls through to static files)", async () => {
    expect(await handleUniversal(authedRequest("http://127.0.0.1:3004/index.html"))).toBeNull();
  });
});
