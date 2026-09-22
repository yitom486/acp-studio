import { describe, expect, test } from "vitest";
import {
  MANAGED_AGENTS,
  agentsHome,
  bridgeSource,
  compareVersions,
  isDev,
  managedDir,
  resolveBridgeExe,
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

  test("bridge source is dev-gated: local only in dev, npm otherwise", () => {
    const prevDev = process.env.ELECTRON_DEV;
    const prevNode = process.env.NODE_ENV;
    const prevSrc = process.env.AGY_ACP_SOURCE;
    try {
      delete process.env.ELECTRON_DEV;
      delete process.env.NODE_ENV;
      process.env.AGY_ACP_SOURCE = "local";
      expect(isDev()).toBe(false);
      expect(bridgeSource()).toBe("npm");

      process.env.ELECTRON_DEV = "1";
      expect(isDev()).toBe(true);
      expect(bridgeSource()).toBe("local");

      delete process.env.ELECTRON_DEV;
      delete process.env.AGY_ACP_SOURCE;
      expect(bridgeSource()).toBe("npm");
    } finally {
      if (prevDev !== undefined) process.env.ELECTRON_DEV = prevDev;
      else delete process.env.ELECTRON_DEV;
      if (prevNode !== undefined) process.env.NODE_ENV = prevNode;
      else delete process.env.NODE_ENV;
      if (prevSrc !== undefined) process.env.AGY_ACP_SOURCE = prevSrc;
      else delete process.env.AGY_ACP_SOURCE;
    }
  });

  test("resolveBridgeExe returns null when nothing is installed (fail fast)", () => {
    const prevHome = process.env.ACP_AGENTS_HOME;
    const prevSrc = process.env.AGY_ACP_SOURCE;
    try {
      // Point managed home at a guaranteed-empty temp dir; local source would
      // hit the real scratch checkout, so force npm source for determinism.
      const tmp = `${process.cwd()}/node_modules/.cache/empty-agents-home`;
      process.env.ACP_AGENTS_HOME = tmp;
      delete process.env.AGY_ACP_SOURCE;
      delete process.env.ELECTRON_DEV;
      expect(bridgeSource()).toBe("npm");
      expect(resolveBridgeExe()).toBeNull();
    } finally {
      if (prevHome !== undefined) process.env.ACP_AGENTS_HOME = prevHome;
      else delete process.env.ACP_AGENTS_HOME;
      if (prevSrc !== undefined) process.env.AGY_ACP_SOURCE = prevSrc;
      else delete process.env.AGY_ACP_SOURCE;
    }
  });
});
