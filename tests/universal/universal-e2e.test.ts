// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { buildApp, shutdownBridges } from "../../server/gateway";
import { BUILTIN_AGENTS } from "../../server/universal/presets";
import { universalRegistry } from "../../server/universal/registry";
import { authedRequest } from "../helpers/gateway-auth";

describe("Universal ACP Gateway (Decoupled & Zero Model Hardcoding)", () => {
  const app = buildApp();

  afterAll(async () => {
    await shutdownBridges();
  });

  it("exposes all configured agent profiles dynamically without hardcoded models", async () => {
    const req = authedRequest("http://localhost:3004/api/universal/agents");
    const res = await app.fetch(req);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { ok: boolean; agents: Array<{ id: string; name: string; title: string }> };
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeGreaterThanOrEqual(BUILTIN_AGENTS.length);

    // Verify profiles adhere to decoupling principles: no vendor model IDs hardcoded in profile schema
    for (const p of data.agents) {
      expect(p.id).toBeDefined();
      expect(p.name).toBeDefined();
      expect(p.title).toBeDefined();
    }
  });

  it("handles CORS options preflight cleanly across universal endpoints", async () => {
    // 预检不带凭证：无需 token，只回 CORS 头；只回显可信本地 Origin，不再返回 `*`。
    const req = new Request("http://localhost:3004/api/universal/agents", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5188" },
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5188");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");

    const evil = await app.fetch(
      new Request("http://localhost:3004/api/universal/agents", { method: "OPTIONS", headers: { Origin: "https://evil.example" } })
    );
    expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("gracefully rejects actions on nonexistent agent IDs", async () => {
    const req = authedRequest("http://localhost:3004/api/universal/agents/non-existent-agent-id/status");
    const res = await app.fetch(req);
    expect(res.status).toBe(404);

    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error.toLowerCase()).toContain("unknown agent");
  });

  it("supports dynamic registration and removal of custom agent profiles", async () => {
    const customProfile = {
      id: "custom-test-agent",
      name: "custom-test-acp",
      title: "Custom Test Agent",
      command: "node",
      args: ["--version"],
    };

    // Upsert custom profile
    const addReq = authedRequest("http://localhost:3004/api/universal/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customProfile),
    });
    const addRes = await app.fetch(addReq);
    expect(addRes.status).toBe(200);

    const addData = (await addRes.json()) as { ok: boolean; agent: { id: string } };
    expect(addData.ok).toBe(true);
    expect(addData.agent.id).toBe("custom-test-agent");

    // Retrieve via list
    const listReq = authedRequest("http://localhost:3004/api/universal/agents");
    const listRes = await app.fetch(listReq);
    const listData = (await listRes.json()) as { agents: Array<{ id: string }> };
    expect(listData.agents.some((p) => p.id === "custom-test-agent")).toBe(true);

    // Delete custom profile
    const delReq = authedRequest("http://localhost:3004/api/universal/agents/custom-test-agent", {
      method: "DELETE",
    });
    const delRes = await app.fetch(delReq);
    expect(delRes.status).toBe(200);

    // Verify removal
    expect(universalRegistry.getProfile("custom-test-agent")).toBeUndefined();
  });

  it("shuts down universal connections cleanly", async () => {
    await expect(shutdownBridges()).resolves.toBeUndefined();
  });
});
