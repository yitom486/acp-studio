import { describe, it, expect } from "vitest";
import { BUILTIN_AGENTS, resolveBuiltin } from "../../server/universal/presets";
import { universalRegistry } from "../../server/universal/registry";

describe("Universal ACP gateway (v1)", () => {
  it("ships codex-acp preset with stdio npx command", () => {
    const codex = resolveBuiltin("codex");
    expect(codex).toBeDefined();
    expect(codex!.command.toLowerCase()).toContain("npx");
    expect(codex!.args!.join(" ")).toContain("@agentclientprotocol/codex-acp");
  });

  it("ships all expected builtins (codex first-class + agy compat)", () => {
    const ids = BUILTIN_AGENTS.map((a) => a.id);
    for (const want of ["codex", "antigravity-stdio", "gemini", "claude", "opencode"]) {
      expect(ids).toContain(want);
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
});
