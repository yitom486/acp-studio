import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MANAGED_AGENTS,
  __clearInstallJobsForTest,
  __setLatestCacheForTest,
  agentsHome,
  bridgeSource,
  checkAgent,
  clearLatestCache,
  compareVersions,
  getInstallJob,
  isDev,
  isDevEnv,
  isSourceCheckout,
  latestTtlMs,
  latestVersionCached,
  managedDir,
  resolveBridgeExe,
  selectEmptySessions,
  specFor,
  startInstall,
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
    // Pure env matrix (no fs): explicit local outside dev falls back to npm.
    expect(isDevEnv({} as any)).toBe(false);
    expect(isDevEnv({ ELECTRON_DEV: "1" } as any)).toBe(true);
    expect(isDevEnv({ NODE_ENV: "development" } as any)).toBe(true);
    // Source checkout counts as dev (this repo root qualifies).
    expect(isSourceCheckout(process.cwd())).toBe(true);
    expect(isDev()).toBe(true);

    const prevSrc = process.env.AGY_ACP_SOURCE;
    const prevDev = process.env.ELECTRON_DEV;
    try {
      delete process.env.AGY_ACP_SOURCE;
      expect(bridgeSource()).toBe("npm");
      // Explicit local is honored in dev.
      process.env.ELECTRON_DEV = "1";
      process.env.AGY_ACP_SOURCE = "local";
      expect(bridgeSource()).toBe("local");
    } finally {
      if (prevSrc !== undefined) process.env.AGY_ACP_SOURCE = prevSrc;
      else delete process.env.AGY_ACP_SOURCE;
      if (prevDev !== undefined) process.env.ELECTRON_DEV = prevDev;
      else delete process.env.ELECTRON_DEV;
    }
  });

  test("selectEmptySessions keeps bound/recent/turned sessions, deletes stale empties", () => {
    const NOW = Date.parse("2026-09-22T15:30:00.000Z");
    const old = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(NOW - 5 * 60 * 1000).toISOString();
    const { deletable, kept } = selectEmptySessions(
      [
        { sessionId: "empty-old" },
        { sessionId: "empty-old-nodate" },
        { sessionId: "bound-empty", updatedAt: old },
        { sessionId: "turned", conversationId: "conv-1", updatedAt: old },
        { sessionId: "fresh-empty", updatedAt: fresh },
        { sessionId: "", updatedAt: old },
      ].map((s) => ({ ...s, updatedAt: (s as any).updatedAt ?? old })),
      { exceptIds: ["bound-empty"], now: NOW },
    );
    expect(deletable.map((d) => d.sessionId).sort()).toEqual(["empty-old", "empty-old-nodate"]);
    expect(kept).toBe(4);
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

  test("latestTtlMs honors ACP_LATEST_TTL_MS (default 10min)", () => {
    const prev = process.env.ACP_LATEST_TTL_MS;
    try {
      delete process.env.ACP_LATEST_TTL_MS;
      expect(latestTtlMs()).toBe(10 * 60 * 1000);
      process.env.ACP_LATEST_TTL_MS = "12345";
      expect(latestTtlMs()).toBe(12345);
      process.env.ACP_LATEST_TTL_MS = "bogus";
      expect(latestTtlMs()).toBe(10 * 60 * 1000);
    } finally {
      if (prev !== undefined) process.env.ACP_LATEST_TTL_MS = prev;
      else delete process.env.ACP_LATEST_TTL_MS;
    }
  });

  test("latestVersionCached hits TTL cache without spawning (offline)", () => {
    const pkg = "@yitom/agy-acp-map";
    clearLatestCache();
    __setLatestCacheForTest(pkg, "9.9.9-test", Date.now());
    const prevNpm = process.env.ACP_NPM_BIN;
    const prevTtl = process.env.ACP_LATEST_TTL_MS;
    // Even with npm missing/bogus, TTL hit must return cached value (no spawn).
    process.env.ACP_NPM_BIN = "/definitely/not/exist/npm-xyz-123";
    process.env.ACP_LATEST_TTL_MS = String(10 * 60 * 1000);
    try {
      expect(latestVersionCached(pkg)).toBe("9.9.9-test");
      // checkAgent() uses the cached latest internally so /install-state never blocks.
      const st = checkAgent("antigravity-stdio");
      expect(st.latestVersion).toBe("9.9.9-test");
    } finally {
      if (prevNpm !== undefined) process.env.ACP_NPM_BIN = prevNpm;
      else delete process.env.ACP_NPM_BIN;
      if (prevTtl !== undefined) process.env.ACP_LATEST_TTL_MS = prevTtl;
      else delete process.env.ACP_LATEST_TTL_MS;
      clearLatestCache();
    }
  });

  test("latestVersionCached miss with no npm returns null (no crash, offline)", () => {
    clearLatestCache();
    const prevNpm = process.env.ACP_NPM_BIN;
    const prevTtl = process.env.ACP_LATEST_TTL_MS;
    process.env.ACP_NPM_BIN = "/definitely/not/exist/npm-xyz-123";
    process.env.ACP_LATEST_TTL_MS = "0";
    try {
      expect(latestVersionCached("some-fake-pkg-xyz-123")).toBeNull();
    } finally {
      if (prevNpm !== undefined) process.env.ACP_NPM_BIN = prevNpm;
      else delete process.env.ACP_NPM_BIN;
      if (prevTtl !== undefined) process.env.ACP_LATEST_TTL_MS = prevTtl;
      else delete process.env.ACP_LATEST_TTL_MS;
      clearLatestCache();
    }
  });

  test("startInstall busy semantics + getInstallJob query (offline, no network)", async () => {
    __clearInstallJobsForTest();
    // NOTE: id must NOT contain "busy" substring — isLockError() scans
    // error+log for /EBUSY|busy|locked|EPERM/i and the spawn cwd (managedDir)
    // leaks the id into Node's MODULE_NOT_FOUND message, causing a false retry.
    const fakeId = "test-managed-tmp-xyz";
    const existing = MANAGED_AGENTS.findIndex((s) => s.id === fakeId);
    if (existing >= 0) MANAGED_AGENTS.splice(existing, 1);
    MANAGED_AGENTS.push({
      id: fakeId,
      pkg: "fake-pkg-xyz-no-network",
      exeRel: "dist/x.exe",
      headlessRel: "dist/h.exe",
    });
    const prevHome = process.env.ACP_AGENTS_HOME;
    const prevNpm = process.env.ACP_NPM_BIN;
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "acp-install-test-"));
    process.env.ACP_AGENTS_HOME = tmpHome;
    // Point npm at a real executable that will fail fast async when given
    // install args (no network): process.execPath running a missing script.
    process.env.ACP_NPM_BIN = process.execPath;
    try {
      const first = startInstall(fakeId);
      expect(first.busy).toBe(false);
      expect(first.job).toBeDefined();
      expect(first.job!.state).toBe("running");
      expect(first.job!.id).toBe(fakeId);

      const second = startInstall(fakeId);
      expect(second.busy).toBe(true);
      expect(second.error).toMatch(/正在安装中/);
      expect(second.job).toBeUndefined();

      const byJobId = getInstallJob(first.job!.jobId);
      expect(byJobId).toBeDefined();
      expect(byJobId!.id).toBe(fakeId);

      const byAgentId = getInstallJob(fakeId);
      expect(byAgentId?.jobId).toBe(first.job!.jobId);

      const unknown = startInstall("no-such-agent-xyz-123");
      expect(unknown.busy).toBe(false);
      expect(unknown.error).toBeDefined();
      expect(unknown.job).toBeUndefined();
      expect(getInstallJob("no-such-job-xyz-123")).toBeUndefined();
    } finally {
      // Let the background fake-npm child exit so Windows releases cwd handles.
      await new Promise((r) => setTimeout(r, 800));
      const idx = MANAGED_AGENTS.findIndex((s) => s.id === fakeId);
      if (idx >= 0) MANAGED_AGENTS.splice(idx, 1);
      if (prevHome !== undefined) process.env.ACP_AGENTS_HOME = prevHome;
      else delete process.env.ACP_AGENTS_HOME;
      if (prevNpm !== undefined) process.env.ACP_NPM_BIN = prevNpm;
      else delete process.env.ACP_NPM_BIN;
      __clearInstallJobsForTest();
      try {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      } catch (err) {
        console.error(`[test] cleanup tmpHome failed: ${(err as Error).message}`);
      }
    }
  });
});
