import { describe, expect, it } from "vitest";
import { initialUpdateState, updateReducer, type UpdateState } from "../../src/lib/update-state";
import { extractSection } from "../../scripts/release-notes";

const run = (actions: Parameters<typeof updateReducer>[1][], s: UpdateState = initialUpdateState) =>
  actions.reduce(updateReducer, s);

describe("update state machine", () => {
  it("available → download → progress → ready", () => {
    const s = run([
      { type: "checking" },
      { type: "available", version: "0.1.2", canAutoInstall: true },
      { type: "download-requested" },
      { type: "progress", percent: 42.4 },
    ]);
    expect(s).toEqual({ phase: "downloading", version: "0.1.2", percent: 42 });
    expect(updateReducer(s, { type: "downloaded", version: "0.1.2" })).toEqual({ phase: "ready", version: "0.1.2", dismissed: false });
  });
  it("background checks don't reset a download or a ready update", () => {
    const ready = run([{ type: "downloaded", version: "0.1.2" }]);
    expect(run([{ type: "checking" }, { type: "not-available" }], ready)).toBe(ready);
  });
  it("dismiss hides but keeps the ready update; errors can be dismissed", () => {
    expect(run([{ type: "downloaded", version: "1" }, { type: "dismiss" }])).toMatchObject({ phase: "ready", dismissed: true });
    expect(run([{ type: "error", message: "x" }, { type: "dismiss" }])).toEqual({ phase: "idle" });
  });
  it("clamps progress", () => {
    const s = run([{ type: "available", version: "1", canAutoInstall: true }, { type: "download-requested" }, { type: "progress", percent: 140 }]);
    expect(s).toMatchObject({ percent: 100 });
  });
});

describe("release notes from CHANGELOG", () => {
  const log = `# Changelog\n\n## [Unreleased]\n\n### Added\n<!-- note -->\n\n## [0.1.1] - 2026-10-12\n\n### Added\n- 自动更新\n<!-- hidden -->\n\n### Fixed\n- bug\n\n## [0.1.0] - 2026-10-11\n\n- first\n\n[Unreleased]: https://x/compare/v0.1.1...HEAD\n[0.1.1]: https://x/releases/tag/v0.1.1\n`;
  it("extracts exactly one version section", () => {
    expect(extractSection(log, "0.1.1")).toBe("### Added\n- 自动更新\n\n### Fixed\n- bug\n");
    expect(extractSection(log, "v0.1.0")).toBe("- first\n");
  });
  it("returns null for missing versions", () => {
    expect(extractSection(log, "9.9.9")).toBeNull();
    expect(extractSection(log, "0.1.10")).toBeNull();
  });
});
