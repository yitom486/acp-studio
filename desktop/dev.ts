/**
 * ACP Studio unified Desktop dev orchestrator.
 * Handles:
 * 1. Preflight stale process cleanup on Windows
 * 2. Compiles desktop/main.ts and desktop/preload.ts
 * 3. Starts dev server and Vite client with color-coded prefix logs
 * 4. Waits for Vite dev server (port 5188) to be ready before launching Electron
 * 5. Watches desktop/ directory for changes and rebuilds main bundle
 * 6. Clean process-tree shutdown on Ctrl+C or when Electron exits
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";

const isWin = process.platform === "win32";
const VITE_PORT = 5188;
const GATEWAY_PORT = 13005;

const children: ChildProcess[] = [];
let isExiting = false;

// ANSI Colors
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function log(prefix: string, color: string, msg: string) {
  const lines = msg.toString().trimEnd().split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    console.log(`${color}[${prefix}]${c.reset} ${line}`);
  }
}

function recyclePort(port: number, serviceName: string): void {
  if (!isWin) return;
  try {
    const stdout = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      encoding: "utf8",
      windowsHide: true,
    });
    const pids = new Set<number>();
    for (const line of stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (pid && !isNaN(pid) && pid !== process.pid) {
        pids.add(pid);
      }
    }
    for (const pid of pids) {
      console.log(`${c.yellow}[launcher] 端口 ${port} (${serviceName}) 残留旧进程 PID ${pid}，taskkill 自动回收...${c.reset}`);
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { windowsHide: true, stdio: "ignore" });
      } catch {}
    }
  } catch {
    // Port is free (findstr exits with code 1)
  }
}

async function cleanupAndExit(code = 0) {
  if (isExiting) return;
  isExiting = true;
  console.log(`\n${c.yellow}[dev:desktop] 正在优雅关闭前后端与桌面进程...${c.reset}`);

  // Collect active child PIDs for atomic batch shutdown
  const pids = children
    .map((child) => child.pid)
    .filter((pid): pid is number => typeof pid === "number");

  if (isWin && pids.length > 0) {
    const pidFlags = pids.flatMap((pid) => ["/PID", String(pid)]).join(" ");
    try {
      execSync(`taskkill /F /T ${pidFlags}`, { windowsHide: true, stdio: "ignore" });
    } catch {}
    try {
      execSync("taskkill /F /IM electron.exe", { windowsHide: true, stdio: "ignore" });
    } catch {}
  } else {
    for (const child of children) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  }

  console.log(`${c.green}[dev:desktop] 所有服务已安全退出。${c.reset}`);
  process.exit(code);
}

process.on("SIGINT", () => cleanupAndExit(0));
process.on("SIGTERM", () => cleanupAndExit(0));

async function waitForVite(port: number, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  const urls = [`http://localhost:${port}/`, `http://127.0.0.1:${port}/`];

  while (Date.now() - start < timeoutMs) {
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.status < 500) return true;
      } catch {
        // still starting up
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function buildElectron(): Promise<boolean> {
  const mainBuild = await Bun.build({
    entrypoints: ["desktop/main.ts"],
    target: "node",
    format: "cjs",
    // node-pty external（同 desktop/build.ts）：native 不可打包进 cjs。
    external: ["electron", "node-pty"],
    outdir: "electron-dist",
    naming: "main.cjs",
  });

  const preloadBuild = await Bun.build({
    entrypoints: ["desktop/preload.ts"],
    target: "node",
    format: "cjs",
    external: ["electron"],
    outdir: "electron-dist",
    naming: "preload.cjs",
  });

  return mainBuild.success && preloadBuild.success;
}

function startSubProcess(name: string, color: string, cmd: string, args: string[]): ChildProcess {
  const child = spawn(cmd, args, {
    shell: isWin,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  child.stdout?.on("data", (data) => log(name, color, data));
  child.stderr?.on("data", (data) => log(name, color, data));

  child.on("exit", (code) => {
    if (!isExiting && code !== 0 && code !== null) {
      log(name, c.red, `进程异常退出 (code: ${code})`);
      cleanupAndExit(code);
    }
  });

  children.push(child);
  return child;
}

async function main() {
  console.log(`${c.bold}${c.magenta}=== ACP Studio 桌面端集成开发环境启动中 ===${c.reset}\n`);

  // 1. Windows preflight: kill lingering electron.exe and reclaim Vite dev port
  if (isWin) {
    try {
      const cleanup = spawn("taskkill", ["/F", "/IM", "electron.exe"], {
        windowsHide: true,
        stdio: "ignore",
      });
      await new Promise((r) => cleanup.on("close", r));
    } catch {}
    recyclePort(GATEWAY_PORT, "Universal Gateway");
    recyclePort(VITE_PORT, "Vite Dev Server");
  }

  // 2. Build electron bundle
  console.log(`${c.cyan}[build] 正在编译 Electron 主进程与 Preload 脚本...${c.reset}`);
  const ok = await buildElectron();
  if (!ok) {
    console.error(`${c.red}[build] Electron 编译失败，请检查报错！${c.reset}`);
    process.exit(1);
  }
  console.log(`${c.green}[build] 编译完成 (electron-dist/main.cjs + preload.cjs)${c.reset}\n`);

  // 3. Start Gateway Server & Vite Client
  // 默认 Bun 网关（快、有 watch）；ACP_GATEWAY=node 时改跑 Node 网关，
  // 真 PTY（node-pty）只在 Node 网关下可用（Bun 下无 native，回落单次模式）。
  const useNodeGateway = process.env.ACP_GATEWAY === "node";
  if (useNodeGateway) {
    console.log(`${c.cyan}[launcher] ACP_GATEWAY=node：改跑 Node 网关，真 PTY 可用。${c.reset}`);
  }
  const serverProc = useNodeGateway
    ? startSubProcess("server", c.cyan, "bun", ["run", "dev:server:node"])
    : startSubProcess("server", c.cyan, "bun", ["--watch", "server/index.ts"]);
  const clientProc = startSubProcess("client", c.green, "bun", ["run", "dev:client"]);

  // 4. Wait for Vite client ready
  console.log(`${c.yellow}[launcher] 正在等待 Vite 开发服务器就绪 (http://localhost:${VITE_PORT})...${c.reset}`);
  const viteReady = await waitForVite(VITE_PORT);
  if (!viteReady) {
    console.warn(`${c.yellow}[launcher] Vite 响应超时，尝试直接拉起 Electron...${c.reset}`);
  } else {
    console.log(`${c.green}[launcher] Vite 开发服务器已就绪！秒开桌面窗口...${c.reset}\n`);
  }

  // 5. Start Electron
  const electronProc = spawn(
    isWin ? "npx.cmd" : "npx",
    ["electron", "electron-dist/main.cjs"],
    {
      shell: isWin,
      stdio: "inherit",
      env: {
        ...process.env,
        ELECTRON_DEV: "1",
        ELECTRON_START_URL: `http://localhost:${VITE_PORT}`,
      },
    }
  );

  children.push(electronProc);

  // When Electron GUI window closes, cleanly shut down server and client
  electronProc.on("exit", (code) => {
    console.log(`\n${c.cyan}[electron] 桌面窗口已关闭${c.reset}`);
    cleanupAndExit(code || 0);
  });

  // 6. Watch desktop directory for edits
  let buildDebounce: Timer | null = null;
  fs.watch("desktop", { recursive: false }, (_event, filename) => {
    if (filename !== "main.ts" && filename !== "preload.ts") return;

    if (buildDebounce) clearTimeout(buildDebounce);
    buildDebounce = setTimeout(async () => {
      console.log(`\n${c.yellow}[watch] 检测到 desktop/${filename} 变更，正在增量构建...${c.reset}`);
      const success = await buildElectron();
      if (success) {
        console.log(`${c.green}[watch] Electron 主进程构建就绪！${c.reset}`);
      }
    }, 200);
  });
}

main().catch((err) => {
  console.error(err);
  cleanupAndExit(1);
});
