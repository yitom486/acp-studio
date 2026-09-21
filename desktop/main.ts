/**
 * ACP Studio desktop shell (Electron main).
 * Starts the Node gateway in-process, then opens the Studio window on it.
 * Dev: ELECTRON_DEV=1 ELECTRON_START_URL=http://localhost:5188 (external vite+gateway).
 */
import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { setupEnv, PORT, buildApp, freePortIfOccupied, shutdownBridges } from "../server/gateway";

const isDev = process.env.ELECTRON_DEV === "1";
const START_URL = process.env.ELECTRON_START_URL || `http://localhost:${PORT}`;

let win: BrowserWindow | null = null;
let gateway: { close: (cb?: () => void) => void } | null = null;

async function startGateway() {
  setupEnv();
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
  const srv = serve({ fetch: honoApp.fetch, port: PORT }, () => {
    console.log(`[Electron] gateway listening at http://localhost:${PORT}`);
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
    } catch {
      // ignore
    }
    await shutdownBridges().catch(() => undefined);
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", async () => {
    await shutdownBridges().catch(() => undefined);
  });
}
