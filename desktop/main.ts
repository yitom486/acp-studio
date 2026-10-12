/**
 * ACP Studio desktop shell (Electron main).
 * Starts the Node gateway in-process, then opens the Studio window on it.
 * Dev: ELECTRON_DEV=1 ELECTRON_START_URL=http://localhost:5188 (external vite+gateway).
 */
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { serve } from "@hono/node-server";
import { setupEnv, PORT, buildApp, freePortIfOccupied, shutdownBridges } from "../server/gateway";
import { ensureGatewayToken, gatewayTokenPreview } from "../server/universal/security";
import { attachPtyUpgrade } from "../server/universal/pty";
import { initUpdater } from "./updater";

const isDev = process.env.ELECTRON_DEV === "1";
const START_URL = process.env.ELECTRON_START_URL || `http://localhost:${PORT}`;

// 设置 Windows 任务栏应用标识与独立分组，确保任务栏图标显示 ACP Studio 猫咪图标而非 Electron 默认原子图标
if (process.platform === "win32") {
  app.setAppUserModelId("studio.acp.app");
}

// 隔离应用名称与 userData 路径，避免开发模式下与本地其他未打包的 Electron 应用（如 inkdown）
// 共享 %APPDATA%\Electron 导致 Chromium ProcessSingleton 单例锁冲突（0x20 锁文件被占用错误）
app.name = "acp-studio";
try {
  const customUserData = path.join(app.getPath("appData"), isDev ? "acp-studio-dev" : "acp-studio");
  app.setPath("userData", customUserData);
} catch (err) {
  console.warn("[Electron] 无法设置独立 userData 路径:", err);
}

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
  // Runner era: agents spawn via bunx/npx directly (windowsHide, no shim);
  // only an explicit AGY_HEADLESS_LAUNCHER env opts back into shimmed spawn.
  if (!isDev) {
    process.env.ACP_PUBLIC_DIR = path.join(app.getAppPath(), "dist");
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
  // 真 PTY 的 WS 升级（与 server/node.ts 同源；Bun dev 网关无此挂载）。
  void attachPtyUpgrade(srv as never);
  gateway = srv;
}

async function loadURLWithRetry(targetWin: BrowserWindow, url: string, maxRetries = 30, intervalMs = 500) {
  for (let i = 0; i < maxRetries; i++) {
    if (targetWin.isDestroyed()) return;
    try {
      await targetWin.loadURL(url);
      return;
    } catch (err: any) {
      if (targetWin.isDestroyed()) return;
      if (i === maxRetries - 1) {
        console.error(`[Electron] 尝试连接开发服务器 ${url} 超时:`, err?.message || err);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

function getAppIcon(): Electron.NativeImage | undefined {
  const candidateDirs = [
    isDev ? path.join(app.getAppPath(), "public") : path.join(app.getAppPath(), "dist"),
    path.join(app.getAppPath(), "public"),
    path.join(app.getAppPath(), "dist"),
    path.join(process.cwd(), "public"),
  ];

  const candidateNames = process.platform === "win32"
    ? ["icon.ico", "icon.png", "acp-studio-cat.png"]
    : ["icon.png", "acp-studio-cat.png", "icon.ico"];

  for (const dir of candidateDirs) {
    for (const name of candidateNames) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        try {
          const img = nativeImage.createFromPath(p);
          if (!img.isEmpty()) return img;
        } catch {
          // ignore and continue
        }
      }
    }
  }

  return undefined;
}

function getSavedOverlayConfig(): { color: string; symbolColor: string } {
  try {
    const configPath = path.join(app.getPath("userData"), "theme-overlay.json");
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (data && typeof data.color === "string" && typeof data.symbolColor === "string") {
        return data;
      }
    }
  } catch {
    // fallback
  }
  return { color: "#171717", symbolColor: "#a5a5a5" };
}

function saveOverlayConfig(cfg: { color: string; symbolColor: string }) {
  try {
    const dir = app.getPath("userData");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const configPath = path.join(dir, "theme-overlay.json");
    fs.writeFileSync(configPath, JSON.stringify(cfg), "utf-8");
  } catch {
    // ignore
  }
}

function getPreloadPath(): string {
  const candidates = [
    path.join(app.getAppPath(), "preload.cjs"),
    path.join(app.getAppPath(), "electron-dist", "preload.cjs"),
    path.join(process.cwd(), "electron-dist", "preload.cjs"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(app.getAppPath(), "electron-dist", "preload.cjs");
}

async function createWindow() {
  const isMac = process.platform === "darwin";
  const appIcon = getAppIcon();
  const initialOverlay = getSavedOverlayConfig();

  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    // 首帧底色跟随上次保存的主题标题栏色，避免启动时闪一下旧的蓝黑底
    backgroundColor: initialOverlay.color,
    title: "ACP Studio",
    icon: appIcon,
    titleBarStyle: "hidden",
    ...(isMac
      ? {
          trafficLightPosition: { x: 12, y: 10 },
        }
      : {}),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (appIcon && !win.isDestroyed()) {
    try {
      win.setIcon(appIcon);
    } catch {
      // ignore
    }
  }

  if (isDev) {
    // 开发模式快捷键：F12 开启开发者工具，F5 刷新
    win.webContents.on("before-input-event", (event, input) => {
      if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) {
        win?.webContents.toggleDevTools();
        event.preventDefault();
      }
      if (input.key === "F5" || (input.control && input.key.toLowerCase() === "r")) {
        win?.webContents.reload();
        event.preventDefault();
      }
    });
    await loadURLWithRetry(win, START_URL);
  } else {
    await win.loadURL(START_URL);
  }

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

// Window controls styling (pure React handles 100% of the UI; kept as no-op for IPC compatibility)
ipcMain.handle("window:setTitleBarOverlay", () => {});

ipcMain.handle("window:minimize", () => {
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.handle("window:maximize", () => {
  if (win && !win.isDestroyed()) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.handle("window:close", () => {
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle("window:isMaximized", () => {
  return win && !win.isDestroyed() ? win.isMaximized() : false;
});

// 网关 token 交给页面：preload 透出 `acpStudio.getGatewayToken()`，前端
// （src/lib/gateway-auth.ts）启动时取一次，之后所有 /api/universal/* 请求带
// `Authorization: Bearer <token>`，PTY WebSocket 带 `?token=`。
// 只响应本应用自己加载的页面（主窗口），其他 webContents 拿不到。
ipcMain.handle("gateway:getToken", (event) => {
  if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id) {
    throw new Error("gateway:getToken denied: caller is not the ACP Studio main window");
  }
  return process.env.ACP_GATEWAY_TOKEN || ensureGatewayToken();
});

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
    initUpdater(() => win);
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

  const handleSignal = () => {
    try {
      gateway?.close();
    } catch {}
    app.quit();
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
}

