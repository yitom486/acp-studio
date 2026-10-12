// @vitest-environment node
/**
 * 工作区写入白名单 + 终端 cwd 显式报错（安全修复回归，Mock 黑盒全链路）：
 * 智能体经 ACP fs/write_text_file 只能写会话工作区（session cwd +
 * additionalDirectories + ACP_WORKSPACE_ROOTS）之内；根外 / 软链接逃逸一律拒绝。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, shutdownBridges } from "../../server/gateway";
import { universalRegistry } from "../../server/universal/registry";
import { dangerousRootReason, isPathAllowed } from "../../server/universal/security";
import { authedRequest } from "../helpers/gateway-auth";
import { rmTempDir } from "../helpers/tmp-cleanup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../fixtures/mock-acp-agent.ts");
const agentId = "mock-guard-agent";
const app = buildApp();

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "acp-guard-")));
const workspace = path.join(base, "workspace");
const extraDir = path.join(base, "extra");
const outside = path.join(base, "outside");

beforeAll(() => {
  for (const d of [workspace, extraDir, outside]) fs.mkdirSync(d, { recursive: true });
  universalRegistry.upsertProfile({
    id: agentId,
    name: "mock-guard",
    title: "Mock Guard Agent",
    command: process.platform === "win32" ? "bun.exe" : "bun",
    args: ["run", fixturePath],
    env: {},
  });
});

afterAll(async () => {
  try {
    await universalRegistry.connFor(agentId).disconnect();
  } catch {
    // 已断开：确定性无害
  }
  universalRegistry.removeProfile(agentId);
  await shutdownBridges();
  // Windows 上 mock 智能体 / 终端子进程可能还短暂占着目录，重试几次再删。
  rmTempDir(base);
});

async function newSession(body: Record<string, unknown>): Promise<string> {
  const res = await app.fetch(
    authedRequest(`http://127.0.0.1:3004/api/universal/agents/${agentId}/session/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const data = (await res.json()) as { ok: boolean; result: { sessionId: string }; error?: string };
  expect(data.ok, data.error).toBe(true);
  return data.result.sessionId;
}

/** 跑一轮 prompt，返回 mock agent 回报的 GUARD:* 文本。 */
async function guardTurn(sessionId: string, prompt: string): Promise<string> {
  const res = await app.fetch(
    authedRequest("http://127.0.0.1:3004/api/universal/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, sessionId, prompt }),
    })
  );
  const text = await res.text();
  let out = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const evt = JSON.parse(line.slice(6));
    const upd = evt.update;
    if (upd?.sessionUpdate === "agent_message_chunk" && upd.content?.type === "text") out += upd.content.text;
  }
  return out;
}

describe("agent fs writes are confined to the session workspace", () => {
  it("allows writes inside session cwd and additionalDirectories", async () => {
    const sid = await newSession({ cwd: workspace, additionalDirectories: [extraDir] });
    const inCwd = path.join(workspace, "sub", "a.txt");
    expect(await guardTurn(sid, `trigger_fs_write ${inCwd}`)).toBe("GUARD:OK");
    expect(fs.readFileSync(inCwd, "utf8")).toBe("mock-write");
    const inExtra = path.join(extraDir, "b.txt");
    expect(await guardTurn(sid, `trigger_fs_write ${inExtra}`)).toBe("GUARD:OK");
    expect(fs.existsSync(inExtra)).toBe(true);
  });

  it("rejects writes outside the allowed roots and never touches the file", async () => {
    const sid = await newSession({ cwd: workspace });
    const target = path.join(outside, "authorized_keys");
    const report = await guardTurn(sid, `trigger_fs_write ${target}`);
    expect(report).toMatch(/^GUARD:ERR:/);
    expect(report).toContain("outside the allowed workspace roots");
    expect(fs.existsSync(target)).toBe(false);
  });

  it("rejects `..` traversal and symlink escapes out of the workspace", async () => {
    const sid = await newSession({ cwd: workspace });
    const traversal = path.join(workspace, "..", "outside", "t.txt");
    expect(await guardTurn(sid, `trigger_fs_write ${traversal}`)).toMatch(/^GUARD:ERR:/);
    expect(fs.existsSync(path.join(outside, "t.txt"))).toBe(false);

    if (process.platform !== "win32") {
      fs.symlinkSync(outside, path.join(workspace, "link-out"));
      const viaLink = path.join(workspace, "link-out", "s.txt");
      expect(await guardTurn(sid, `trigger_fs_write ${viaLink}`)).toMatch(/^GUARD:ERR:/);
      expect(fs.existsSync(path.join(outside, "s.txt"))).toBe(false);
    }
  });

  it("refuses filesystem root / system dirs as a session workspace", async () => {
    const res = await app.fetch(
      authedRequest(`http://127.0.0.1:3004/api/universal/agents/${agentId}/session/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path.parse(workspace).root }),
      })
    );
    const data = (await res.json()) as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toContain("session workspace rejected");
  });
});

describe("workspace validate (adding a folder in the UI)", () => {
  async function validate(p: string) {
    const res = await app.fetch(
      authedRequest("http://127.0.0.1:3004/api/universal/workspace/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: p }),
      })
    );
    return { status: res.status, body: (await res.json()) as { ok: boolean; path?: string; error?: string } };
  }

  it("still accepts a normal project folder anywhere on disk", async () => {
    const r = await validate(workspace);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("rejects the filesystem root with 403", async () => {
    const r = await validate(path.parse(workspace).root);
    expect(r.status).toBe(403);
    expect(r.body.ok).toBe(false);
  });
});

describe("isPathAllowed / dangerousRootReason units", () => {
  it("treats session roots as allowed and everything else as denied", () => {
    expect(isPathAllowed(path.join(workspace, "x"), [workspace])).toBe(true);
    expect(isPathAllowed(path.join(outside, "x"), [workspace])).toBe(false);
    expect(isPathAllowed("", [workspace])).toBe(false);
    // 根本身是危险目录时不算数
    expect(isPathAllowed(path.join(path.parse(workspace).root, "anything"), [path.parse(workspace).root])).toBe(false);
  });

  it("flags fs root and system dirs", () => {
    expect(dangerousRootReason(path.parse(workspace).root)).toBeTruthy();
    expect(dangerousRootReason(workspace)).toBeNull();
    if (process.platform !== "win32") expect(dangerousRootReason("/etc/nginx")).toBeTruthy();
  });
});

describe("terminal cwd: explicit errors instead of silent fallback", () => {
  async function exec(body: Record<string, unknown>) {
    const res = await app.fetch(
      authedRequest("http://127.0.0.1:3004/api/universal/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
    return res;
  }

  it("gateway terminal/exec: missing cwd dir → 400 with the path, nothing runs", async () => {
    const ghost = path.join(base, "does-not-exist");
    const res = await exec({ cwd: ghost, command: "echo should-not-run" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain(ghost);
  });

  it("gateway terminal/exec: cwd pointing at a file or omitted → 400", async () => {
    const file = path.join(base, "plain.txt");
    fs.writeFileSync(file, "x");
    expect((await exec({ cwd: file, command: "echo x" })).status).toBe(400);
    const omitted = await exec({ command: "echo x" });
    expect(omitted.status).toBe(400);
    expect(((await omitted.json()) as { error: string }).error).toBe("cwd is required");
  });

  it("ACP terminal/create: missing cwd is reported back to the agent", async () => {
    const sid = await newSession({ cwd: workspace });
    const ghost = path.join(base, "nope-dir");
    const report = await guardTurn(sid, `trigger_terminal_create ${ghost}`);
    expect(report).toMatch(/^GUARD:ERR:/);
    expect(report).toContain("cwd does not exist");
    expect(await guardTurn(sid, `trigger_terminal_create ${workspace}`)).toBe("GUARD:OK");
  });
});
