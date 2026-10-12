/**
 * 自动更新（electron-updater + GitHub Releases）。
 * - autoDownload=false：发现新版只通知，用户点“更新”才下载（差分 blockmap）。
 * - autoInstallOnAppQuit=true：下载完不重启也行，退出/下次启动前静默安装，不走安装向导。
 * - macOS 未签名时 Squirrel.Mac 无法安装 → 只提示并打开 Release 页；Linux 仅 AppImage 可自动更新。
 */
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { autoUpdater } from "electron-updater";

const RELEASES_URL = "https://github.com/yitom486/acp-studio/releases/latest";
const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** 当前平台/打包形态能否自动安装更新。 */
export function canAutoInstall(platform = process.platform, env = process.env): boolean {
  if (platform === "win32") return true;
  if (platform === "linux") return Boolean(env.APPIMAGE);
  // 未签名的 mac 包无法被 Squirrel.Mac 安装；签名后设 ACP_MAC_SIGNED=1 打包即可开启
  if (platform === "darwin") return env.ACP_MAC_SIGNED === "1";
  return false;
}

export function initUpdater(getWin: () => BrowserWindow | null) {
  const send = (payload: unknown) => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send("update:event", payload);
  };
  const enabled = app.isPackaged && process.env.ACP_DISABLE_UPDATES !== "1";
  const autoInstall = canAutoInstall();

  ipcMain.handle("update:getInfo", () => ({ version: app.getVersion(), enabled, canAutoInstall: autoInstall }));
  ipcMain.handle("update:check", async () => {
    if (!enabled) return;
    await autoUpdater.checkForUpdates().catch((e) => send({ type: "error", message: String(e?.message || e) }));
  });
  ipcMain.handle("update:download", async () => {
    if (!enabled) return;
    if (!autoInstall) {
      await shell.openExternal(RELEASES_URL);
      return;
    }
    await autoUpdater.downloadUpdate().catch((e) => send({ type: "error", message: String(e?.message || e) }));
  });
  ipcMain.handle("update:install", () => {
    if (!enabled) return;
    // isSilent=true：NSIS 静默安装；isForceRunAfter=true：装完重新打开
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });
  ipcMain.handle("update:openReleases", () => shell.openExternal(RELEASES_URL));

  if (!enabled) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = autoInstall;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => send({ type: "checking" }));
  autoUpdater.on("update-not-available", () => send({ type: "not-available" }));
  autoUpdater.on("update-available", (info) =>
    send({
      type: "available",
      version: info.version,
      notes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
      canAutoInstall: autoInstall,
    }),
  );
  autoUpdater.on("download-progress", (p) => send({ type: "progress", percent: p.percent }));
  autoUpdater.on("update-downloaded", (info) => send({ type: "downloaded", version: info.version }));
  autoUpdater.on("error", (e) => send({ type: "error", message: String(e?.message || e) }));

  const check = () => autoUpdater.checkForUpdates().catch((e) => console.warn("[updater] 检查更新失败:", e?.message || e));
  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS).unref?.();
}
