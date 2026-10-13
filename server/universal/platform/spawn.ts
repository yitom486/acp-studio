import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Native Windows headless launcher (GUI-subsystem shim that spawns console
 * binaries with CREATE_NO_WINDOW + stdio passthrough).
 * Runner era: package-runner binaries (bunx/npx/node/…) spawn directly with
 * windowsHide and bypass the launcher (see spawnCrossPlatform), so a missing
 * launcher is the normal case — only an explicit AGY_HEADLESS_LAUNCHER env
 * opts back into shimmed spawning. Debug-level when absent, never loud.
 */
let cachedLauncher: string | null | undefined;

export function findHeadlessLauncher(): string | null {
  if (cachedLauncher !== undefined) return cachedLauncher;
  cachedLauncher = null;
  const p = process.env.AGY_HEADLESS_LAUNCHER;
  if (p && fs.existsSync(p)) {
    cachedLauncher = p;
    return cachedLauncher;
  }
  console.debug("[UniversalACP] no headless launcher configured; runners spawn directly with windowsHide.");
  return cachedLauncher;
}

function isLauncherItself(command: string, launcher: string): boolean {
  if (path.basename(command).toLowerCase() === "agy-headless.exe") return true;
  try {
    return path.resolve(command) === path.resolve(launcher);
  } catch {
    return false;
  }
}

/**
 * Runtime binaries that must NEVER go through agy-headless.exe launcher.
 * The launcher only proxies real console business exes (e.g. agy-acp-win-x64.exe);
 * proxying a language runtime (bun/node/npm/...) makes the launcher try to
 * exec it as a payload and surfaces as `Access is denied` (mock tests hit this
 * with `bun.exe run <fixture>`). Case-insensitive basename match, with and
 * without Windows extension.
 */
export const RUNTIME_BASENAMES = new Set([
  "bun",
  "bun.exe",
  "bunx",
  "bunx.exe",
  "bunx.cmd",
  "node",
  "node.exe",
  "npm",
  "npm.cmd",
  "npm.exe",
  "npx",
  "npx.cmd",
  "npx.exe",
  "python",
  "python.exe",
  "python3",
  "python3.exe",
  "pip",
  "pip.exe",
  "uv",
  "uv.exe",
  "deno",
  "deno.exe",
]);

export function isRuntimeBinary(command: string): boolean {
  try {
    return RUNTIME_BASENAMES.has(path.basename(command).toLowerCase());
  } catch (err) {
    console.error(`[UniversalACP] isRuntimeBinary check failed for ${command}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Cross-runtime spawn (Bun *and* Node) with zero console flash on Windows.
 * Console binaries (.exe/.cmd/.bat) go through the native headless launcher
 * when available (works under every runtime, unlike windowsHide under Bun);
 * .cmd/.bat additionally fall back to shell:true for Node's EINVAL.
 * Runtime binaries (bun/node/npm/...) bypass the launcher entirely.
 */
export function spawnCrossPlatform(command: string, args: string[], opts: SpawnOptions): ChildProcess {
  if (isRuntimeBinary(command)) {
    // Runtimes manage their own stdio/console; launcher proxy would break them.
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
      const line = [command, ...args]
        .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
        .join(" ");
      return spawn(line, { ...opts, shell: true });
    }
    return spawn(command, args, opts);
  }
  if (process.platform === "win32" && /\.(exe|cmd|bat)$/i.test(command)) {
    const launcher = findHeadlessLauncher();
    if (launcher && !isLauncherItself(command, launcher)) {
      return spawn(launcher, [command, ...args], { ...opts, shell: false });
    }
    if (/\.(cmd|bat)$/i.test(command)) {
      const line = [command, ...args]
        .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
        .join(" ");
      return spawn(line, { ...opts, shell: true });
    }
  }
  return spawn(command, args, opts);
}

/**
 * Resolve a command the way the OS would (PATH scan, PATHEXT on Windows).
 * Returns the absolute path or null — used to fail fast with the preset's
 * installHint instead of a cryptic ENOENT/EINVAL from spawn.
 */
export function whichCommand(command: string): string | null {
  if (!command) return null;
  const isAbs = path.isAbsolute(command);
  const dirs = isAbs
    ? [path.dirname(command)]
    : (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const base = isAbs ? path.basename(command) : command;
  const exts =
    process.platform === "win32" && !path.extname(base)
      ? ["", ".exe", ".cmd", ".bat", ".ps1"]
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
  // Absolute path that exists but isn't executable-flagged (Windows has no X_OK).
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
