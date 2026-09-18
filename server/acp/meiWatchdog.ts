/**
 * meiWatchdog.ts — standalone crash-proof janitor for PyInstaller _MEI residue.
 *
 * Run detached: `bun server/acp/meiWatchdog.ts <watchDir> <registryPath> <serverHbPath> <pidFile>`
 * Survives the main server crashing (it is a separate OS process). Every 60s it:
 *  1. Prunes registry entries whose ACP pid is dead and deletes their _MEI dir;
 *  2. If the server heartbeat is stale (>3min = server crashed/hung), kills
 *     orphaned ACP images and sweeps every tracked dir, then exits (next
 *     server boot respawns a fresh watchdog).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const [watchDir, registryPath, serverHbPath, pidFile] = process.argv.slice(2);
if (!watchDir || !registryPath || !serverHbPath || !pidFile) {
  console.error("usage: meiWatchdog.ts <watchDir> <registryPath> <serverHbPath> <pidFile>");
  process.exit(2);
}

const ACP_IMAGES = ["agy_acp_server.exe", "localharness_external.exe"];
const logFile = path.join(watchDir, "watchdog.log");

function log(msg: string) {
  try {
    fs.mkdirSync(watchDir, { recursive: true });
    let prev = "";
    try { prev = fs.readFileSync(logFile, "utf8"); } catch {}
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    const kept = (prev + line).split("\n").slice(-200).join("\n");
    fs.writeFileSync(logFile, kept);
  } catch {}
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function loadRegistry(): { pid: number; dir: string; startedAt: number }[] {
  try {
    const raw = fs.readFileSync(registryPath, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveRegistry(entries: { pid: number; dir: string; startedAt: number }[]) {
  try { fs.writeFileSync(registryPath, JSON.stringify(entries, null, 2)); } catch {}
}

function removeDir(dir: string): boolean {
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; }
  catch { return false; } // locked by a live process -> keep
}

/** Delete dirs of registry entries whose owner pid is gone. Returns survivors. */
function pruneDeadEntries(): { pid: number; dir: string; startedAt: number }[] {
  const entries = loadRegistry();
  const survivors: typeof entries = [];
  for (const e of entries) {
    if (pidAlive(e.pid)) { survivors.push(e); continue; }
    if (removeDir(e.dir) || !fs.existsSync(e.dir)) {
      log(`pruned _MEI dir of dead PID ${e.pid}: ${e.dir}`);
    } else {
      log(`kept locked dir of dead PID ${e.pid} (will retry): ${e.dir}`);
      survivors.push(e);
    }
  }
  saveRegistry(survivors);
  return survivors;
}

function queryAgy(): { pid: number; ppid: number }[] {
  if (process.platform !== "win32") return [];
  const filter = ACP_IMAGES.map((n) => `Name='${n}'`).join(" OR ");
  const ps = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`;
  try {
    const raw = execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { encoding: "utf8" }).trim();
    if (!raw) return [];
    const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)];
    return arr.map((e: any) => ({ pid: Number(e.ProcessId), ppid: Number(e.ParentProcessId) }));
  } catch { return []; }
}

function readServerHb(): { pid: number; ts: number } | null {
  try {
    const o = JSON.parse(fs.readFileSync(serverHbPath, "utf8"));
    return { pid: Number(o.pid), ts: Number(o.ts) };
  } catch { return null; }
}

function killOrphans(spare: Set<number>) {
  const procs = queryAgy();
  const live = new Set(procs.map((p) => p.pid));
  for (const n of spare) live.add(n);
  for (const p of procs) {
    if (spare.has(p.pid)) continue;
    if (!live.has(p.ppid)) {
      try {
        execSync(`taskkill /F /T /PID ${p.pid} 2>nul`);
        log(`killed orphaned ACP PID ${p.pid} (parent ${p.ppid} gone)`);
      } catch {}
    }
  }
}

fs.writeFileSync(pidFile, String(process.pid));
log(`watchdog started (pid ${process.pid}), watching ${watchDir}`);
pruneDeadEntries();

const timer = setInterval(() => {
  try {
    pruneDeadEntries();
    const hb = readServerHb();
    const stale = !hb || Date.now() - hb.ts > 3 * 60 * 1000 || !pidAlive(hb.pid);
    if (stale) {
      log("server heartbeat stale — assuming crash, taking over cleanup");
      const spare = new Set<number>([process.pid]);
      if (hb && pidAlive(hb.pid)) spare.add(hb.pid); // hung server: sweep dirs only, spare the process
      killOrphans(spare);
      // One more pass: everything tracked that is now dead gets deleted.
      const entries = loadRegistry();
      const survivors: typeof entries = [];
      for (const e of entries) {
        if ((hb && e.pid === hb.pid && pidAlive(hb.pid)) || pidAlive(e.pid)) { survivors.push(e); continue; }
        if (removeDir(e.dir)) log(`post-crash sweep removed: ${e.dir}`);
        else if (fs.existsSync(e.dir)) survivors.push(e);
      }
      saveRegistry(survivors);
      log("takeover complete, watchdog exiting");
      clearInterval(timer);
      process.exit(0);
    }
  } catch (err: any) {
    log(`tick error: ${err?.message}`);
  }
}, 60_000);
