import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BUILTIN_AGENTS, resolveBuiltin } from "../../server/universal/presets";
import { universalRegistry, customAgentsFile } from "../../server/universal/registry";
import { whichCommand } from "../../server/universal/AgentConnection";

const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "acp-agents-")), "agents.json");
const realEnv = process.env.ACP_AGENTS_FILE;

beforeAll(() => {
  process.env.ACP_AGENTS_FILE = tmpFile;
  universalRegistry.reloadCustomProfiles();
});

afterAll(() => {
  if (realEnv === undefined) delete process.env.ACP_AGENTS_FILE;
  else process.env.ACP_AGENTS_FILE = realEnv;
  universalRegistry.reloadCustomProfiles();
  try {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("Universal ACP gateway (v1)", () => {
  it("ships codex-acp preset with stdio command (local or npx fallback)", () => {
    const codex = resolveBuiltin("codex");
    expect(codex).toBeDefined();
    const cmd = codex!.command.toLowerCase();
    expect(cmd.includes("npx") || cmd.includes("node") || cmd.includes("bun")).toBe(true);
    const argsNormalized = codex!.args!.join(" ").replace(/\\/g, "/");
    expect(argsNormalized).toContain("@agentclientprotocol/codex-acp");
  });

  it("ships all expected builtins (official CLI entries)", () => {
    const ids = BUILTIN_AGENTS.map((a) => a.id);
    for (const want of ["codex", "antigravity-stdio", "gemini", "claude", "opencode", "cursor-cli", "cursor-adapter", "deepseek", "copilot"]) {
      expect(ids).toContain(want);
    }
  });

  it("uses official binaries: opencode acp, agent acp, dsh --profile acp", () => {
    const opencode = resolveBuiltin("opencode")!;
    expect(opencode.command.toLowerCase()).toContain("opencode");
    expect(opencode.args).toEqual(["acp"]);

    const cursor = resolveBuiltin("cursor-cli")!;
    expect(cursor.command.toLowerCase()).toContain("agent");
    expect(cursor.args).toEqual(["acp"]);

    const deepseek = resolveBuiltin("deepseek")!;
    expect(deepseek.args).toEqual(["-y", "@deepseek-ai/dsh", "--profile", "acp"]);
  });

  it("every builtin documents local-auth reuse (shell principle)", () => {
    for (const p of BUILTIN_AGENTS) {
      expect(p.authHint, p.id).toBeTruthy();
    }
  });

  it("registry lists profiles with disconnected status initially", () => {
    const profiles = universalRegistry.listProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    const statuses = universalRegistry.statuses();
    expect(statuses.length).toBe(profiles.length);
  });

  it("status exposes authStatus/meta passthrough (null when disconnected)", () => {
    const statuses = universalRegistry.statuses();
    for (const s of statuses) {
      expect(s).toHaveProperty("authStatus");
      expect(s).toHaveProperty("meta");
    }
    const codex = statuses.find((s) => s.id === "codex")!;
    expect(codex.connected).toBe(false);
    expect(codex.authStatus).toBeNull();
  });

  it("rejects unknown agent ids with helpful error", () => {
    expect(() => universalRegistry.connFor("no-such-agent-xyz")).toThrow(/Unknown agent/);
  });

  it("whichCommand resolves real binaries and misses fantasy ones", () => {
    expect(whichCommand(process.execPath)).toBeTruthy();
    expect(whichCommand("definitely-not-a-binary-xyz-123")).toBeNull();
  });

  it("supports custom profile upsert + remove (non-builtin only)", () => {
    universalRegistry.upsertProfile({
      id: "test-custom",
      name: "test",
      title: "Test",
      command: process.platform === "win32" ? "cmd.exe" : "echo",
      args: [],
      env: {},
    });
    expect(universalRegistry.getProfile("test-custom")).toBeDefined();
    expect(universalRegistry.removeProfile("test-custom")).toBe(true);
    // builtins cannot be removed
    expect(universalRegistry.removeProfile("codex")).toBe(false);
  });

  it("persists custom profiles to disk and reloads them", () => {
    universalRegistry.upsertProfile({
      id: "test-persist",
      name: "test",
      title: "Persist",
      command: "echo",
      args: ["hi"],
      env: {},
      authHint: "demo",
    });
    const onDisk = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    expect(onDisk.map((p: any) => p.id)).toContain("test-persist");
    universalRegistry.reloadCustomProfiles();
    expect(universalRegistry.getProfile("test-persist")?.authHint).toBe("demo");
    expect(customAgentsFile()).toBe(tmpFile);
    universalRegistry.removeProfile("test-persist");
    expect(universalRegistry.getProfile("test-persist")).toBeUndefined();
  });
});
