import { describe, expect, test } from "vitest";
import {
  MANAGED_AGENTS,
  agentsHome,
  compareVersions,
  managedDir,
  specFor,
} from "../../server/universal/agent-installer";

describe("agent-installer (offline)", () => {
  test("managed spec table covers antigravity-stdio with exe paths", () => {
    const spec = specFor("antigravity-stdio");
    expect(spec).toBeDefined();
    expect(spec!.pkg).toBe("@yitom/agy-acp-map");
    expect(spec!.exeRel).toContain("agy-acp-win-x64.exe");
    expect(spec!.headlessRel).toContain("agy-headless.exe");
    expect(specFor("no-such-agent")).toBeUndefined();
    expect(MANAGED_AGENTS.length).toBeGreaterThanOrEqual(1);
  });

  test("managed paths stay under the agents home", () => {
    const home = agentsHome();
    expect(home.length).toBeGreaterThan(0);
    expect(managedDir("antigravity-stdio").startsWith(home)).toBe(true);
  });

  test("compareVersions orders semver numerically", () => {
    expect(compareVersions("0.1.6", "0.1.5")).toBe(1);
    expect(compareVersions("0.1.5", "0.1.6")).toBe(-1);
    expect(compareVersions("0.1.6", "0.1.6")).toBe(0);
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
  });
});
