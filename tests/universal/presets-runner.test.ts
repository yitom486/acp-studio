import { describe, expect, test } from "vitest";
import * as path from "node:path";
import { resolveBuiltin } from "../../server/universal/presets";

describe("presets runner-mode (offline)", () => {
  test("antigravity-stdio resolves to a package runner, never the agy exe", () => {
    const p = resolveBuiltin("antigravity-stdio");
    expect(p).toBeDefined();
    // bunx (or npx fallback) + pinned @latest, same as codex. The runner
    // binary itself may be an .exe on Windows — what matters is we never
    // point at the bridge exes.
    const base = path.basename(p!.command).toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
    expect(["bunx", "npx"]).toContain(base);
    expect(p!.args.join(" ")).toContain("@yitom/agy-acp-map@latest");
    expect(`${p!.command} ${p!.args.join(" ")}`.toLowerCase()).not.toContain("agy-acp-win-x64");
    expect(`${p!.command} ${p!.args.join(" ")}`.toLowerCase()).not.toContain("agy-headless");
  });

  test("codex stays runner-based (regression guard)", () => {
    const p = resolveBuiltin("codex");
    expect(p).toBeDefined();
    expect(p!.args.join(" ")).toContain("@agentclientprotocol/codex-acp@latest");
  });
});
