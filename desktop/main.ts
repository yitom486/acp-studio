/**
 * ACP Studio desktop shell (Electron main).
 * Starts the Node gateway in-process, then opens the Studio window on it.
 * Dev: ELECTRON_DEV=1 ELECTRON_START_URL=http://localhost:5188 (external vite+gateway).
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { setupEnv, PORT, buildApp, freePortIfOccupied, shutdownBridges } from "../server/gateway";
import { ensureGatewayToken, gatewayTokenPreview } from "../server/universal/security";

const isDev = process.env.ELECTRON_DEV === "1";
const START_URL = process.env.ELECTRON_START_URL || `http://localhost:${PORT}`;

let win: BrowserWindow | null = null;
let gateway: { close: (cb?: () => void) => void } | null = null;

async function startGateway() {
  setupEnv();
  // 本函数只在 !isDev 时被调用：确保 token 已生成并进入进程环境，
  // createWindow 在其之后执行，同一机器前后端共享同一 token。
  const token = ensureGatewayToken();
  if (!process.env.ACP_GATEWAY_TOKEN) process.env.ACP_GATEWAY_TOKEN = token;
  freePortIfOccupied(PORT);
  // Packaged layout: frontend lives under <app>/dist, not cwd.
  // Ship agy-headless.exe via electron-builder extraResources later;
  // when present, all console children spawn with CREATE_NO_WINDOW.
  if (!isDev) {
    process.env.ACP_PUBLIC_DIR = path.join(app.getAppPath(), "dist");
    const exe = path.join(process.resourcesPath, "agy-headless.exe");
    if (existsSync(exe)) process.env.AGY_HEADLESS_LAUNCHER = exe;
  }
  const honoApp = buildApp();
  // hostname 127.0.0.1：只绑回环（ACP_PUBLIC_DIR 逻辑不动）。
  const srv = serve({ fetch: honoApp.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
    // token 只打前8位+掩码，不打全量进日志。
    console.log(`[Electron] gateway listening at http://127.0.0.1:${PORT} (token ${gatewayTokenPreview()})`);
  }) as unknown as {
    requestTimeout: number;
    headersTimeout: number;
    close: (cb?: () => void) => void;
  };
  // Never cut long-lived SSE streams.
  srv.requestTimeout = 0;
  srv.headersTimeout = 0;
  gateway = srv;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#0b0e14",
    title: "ACP Studio",
    webPreferences: {
      // NOTE: no __dirname here — bun inlines it at bundle time.
      // getAppPath() works both in dev (project root) and packaged app.
      preload: path.join(app.getAppPath(), "electron-dist", "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  await win.loadURL(START_URL);
  win.on("closed", () => {
    win = null;
  });
}

// Native Desktop IPC Handlers: Folder selection & system explorer reveal
ipcMain.handle("dialog:openDirectory", async () => {
  const targetWin = win || BrowserWindow.getFocusedWindow();
  const res = await dialog.showOpenDialog(targetWin!, {
    properties: ["openDirectory"],
    title: "选择项目工作区目录",
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

ipcMain.handle("shell:openPath", async (_event, targetPath: string) => {
  if (!targetPath) return;
  await shell.openPath(targetPath);
});

// 预留给前端接线：renderer（经 preload 透出后）用该 IPC 拿 token，
// 再在 fetch 头带 `Authorization: Bearer <token>`。
// 当前前端尚未接入：Electron 经 http://127.0.0.1 同源（或 file:// 无 Origin）
// 由 universal/security.ts 直接放行；此处不改 loadURL、不破坏现有启动。
ipcMain.handle("gateway:getToken", () => process.env.ACP_GATEWAY_TOKEN || ensureGatewayToken());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    if (!isDev) await startGateway();
    await createWindow();
  });

  app.on("window-all-closed", async () => {
    try {
      gateway?.close();
    } catch (err) {
      // 关闭已关的 server 属确定性无害，留痕即可。
      console.warn(`[Electron] 关闭网关时异常（已忽略）：${(err as Error).message}`);
    }
    await shutdownBridges().catch((err) => {
      console.warn(`[Electron] 关闭 agent 桥接失败：${(err as Error)?.message || err}`);
    });
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", async () => {
    await shutdownBridges().catch((err) => {
      console.warn(`[Electron] 退出前关闭桥接失败：${(err as Error)?.message || err}`);
    });
  });
}
