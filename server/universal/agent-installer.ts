import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * On-demand agent runtimes (fail-fast, no silent fallbacks).
 *
 * Managed agents live under ~/.acp-studio/agents/<agentId>/node_modules/<pkg>
 * and are installed/updated explicitly via the UI (one-click) or API — never
 * silently. Version freshness is always VISIBLE (install-state endpoint + UI
 * badge); nothing auto-installs behind the user's back.
 */

export interface ManagedAgentSpec {
  /** Preset id, e.g. 'antigravity-stdio'. */
  id: string;
  /** npm package providing the runtime, e.g. '@yitom/agy-acp-map'. */
  pkg: string;
  /** Bridge entry relative to the installed package dir. */
  exeRel: string;
  /** Headless launcher relative to the installed package dir. */
  headlessRel: string;
}

export const MANAGED_AGENTS: ManagedAgentSpec[] = [
  {
    id: "antigravity-stdio",
    pkg: "@yitom/agy-acp-map",
    exeRel: "dist/agy-acp-win-x64.exe",
    headlessRel: "dist/agy-headless.exe",
  },
];

export function specFor(id: string): ManagedAgentSpec | undefined {
  return MANAGED_AGENTS.find((s) => s.id === id);
}

/** Override with ACP_AGENTS_HOME. */
export function agentsHome(): string {
  return process.env.ACP_AGENTS_HOME || path.join(os.homedir(), ".acp-studio", "agents");
}

export function managedDir(id: string): string {
  return path.join(agentsHome(), id);
}

export function managedPkgDir(spec: ManagedAgentSpec): string {
  return path.join(managedDir(spec.id), "node_modules", spec.pkg);
}

function readPkgVersion(pkgDir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(pkgDir, "package.json"), "utf8");
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

export function managedExe(spec: ManagedAgentSpec): string | null {
  const p = path.join(managedPkgDir(spec), spec.exeRel);
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return p;
  } catch {
    return null;
  }
}

export function managedHeadless(spec: ManagedAgentSpec): string | null {
  const p = path.join(managedPkgDir(spec), spec.headlessRel);
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return p;
  } catch {
    return null;
  }
}

/** Numeric semver-ish compare: 1 => a newer, -1 => b newer, 0 => equal/unknown. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10));
  const pb = b.split(".").map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (Number.isNaN(na) || Number.isNaN(nb)) continue;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  return 0;
}

function npmBin(): string | null {
  return whichCommand(process.platform === "win32" ? "npm.cmd" : "npm");
}

/** Minimal PATH scan (local copy so this module never imports AgentConnection). */
function whichCommand(command: string): string | null {
  if (!command) return null;
  const isAbs = path.isAbsolute(command);
  const dirs = isAbs
    ? [path.dirname(command)]
    : (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const base = isAbs ? path.basename(command) : command;
  const exts =
    process.platform === "win32" && !path.extname(base)
      ? ["", ".exe", ".cmd", ".bat"]
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, base + ext);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // try next
      }
    }
  }
  if (isAbs) {
    try {
      fs.accessSync(command, fs.constants.F_OK);
      return command;
    } catch {
      // miss
    }
  }
  return null;
}

/** Registry latest via `npm view` (honors npm/proxy config). Null on any failure. */
export function latestVersion(pkg: string, timeoutMs = 20000): string | null {
  const npm = npmBin();
  if (!npm) return null;
  try {
    const r = spawnSync(npm, ["view", pkg, "version"], {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return null;
    const v = String(r.stdout || "").trim().split(/\s+/).pop() || "";
    return /^[0-9][0-9A-Za-z.\-+]*$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export interface InstallState {
  id: string;
  pkg: string;
  managed: boolean;
  installed: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  command: string | null;
  installHint: string;
}

export function checkAgent(id: string): InstallState {
  const spec = specFor(id);
  if (!spec) {
    return {
      id,
      pkg: "",
      managed: false,
      installed: false,
      installedVersion: null,
      latestVersion: null,
      updateAvailable: false,
      command: null,
      installHint: `Agent '${id}' 不是按需管理的 agent，无一键安装。`,
    };
  }
  const exe = managedExe(spec);
  const installedVersion = exe ? readPkgVersion(managedPkgDir(spec)) : null;
  const latest = latestVersion(spec.pkg);
  return {
    id,
    pkg: spec.pkg,
    managed: true,
    installed: exe !== null,
    installedVersion,
    latestVersion: latest,
    updateAvailable:
      installedVersion !== null && latest !== null
        ? compareVersions(latest, installedVersion) > 0
        : false,
    command: exe,
    installHint: exe
      ? ""
      : `Agent '${id}' 尚未安装。请在界面点击「安装 ${spec.pkg}」一键拉取最新版（约 100MB，含 Windows 单文件 exe）。`,
  };
}

export interface InstallResult {
  ok: boolean;
  version?: string;
  alreadyLatest?: boolean;
  error?: string;
  log?: string;
}

const installInFlight = new Set<string>();

/**
 * One-click install/update to the registry latest. Synchronous (may take
 * ~1min for ~100MB); concurrent calls for the same id get 409 busy.
 * Never falls back, never masks: failures return ok:false with the raw log.
 */
export function installAgent(id: string): InstallResult {
  const spec = specFor(id);
  if (!spec) return { ok: false, error: `Agent '${id}' 不是按需管理的 agent。` };
  if (installInFlight.has(id)) {
    return { ok: false, error: `'${id}' 正在安装中，请稍候再试。` };
  }
  const npm = npmBin();
  if (!npm) {
    return {
      ok: false,
      error: "找不到 npm（不在 PATH 中）。请先安装 Node.js 20+ 再一键安装。",
    };
  }
  installInFlight.add(id);
  try {
    const dir = managedDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync(
      npm,
      ["install", "--prefix", dir, "--no-audit", "--no-fund", `${spec.pkg}@latest`],
      { encoding: "utf8", timeout: 600_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    const log = `${r.stdout || ""}\n${r.stderr || ""}`.slice(-4000);
    if (r.error) {
      return { ok: false, error: `安装进程失败：${r.error.message}`, log };
    }
    if (r.status !== 0) {
      return { ok: false, error: `npm install 退出码 ${r.status}`, log };
    }
    const version = readPkgVersion(managedPkgDir(spec));
    const exe = managedExe(spec);
    if (!exe) {
      return {
        ok: false,
        error: `安装完成但找不到入口 ${spec.exeRel}，包内容异常。`,
        log,
      };
    }
    return { ok: true, version: version ?? undefined, log };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    installInFlight.delete(id);
  }
}
