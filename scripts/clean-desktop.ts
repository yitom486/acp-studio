/**
 * Standalone process and port cleaner for ACP Studio.
 * Run: bun run clean
 */
import { spawn } from "node:child_process";

const isWin = process.platform === "win32";

console.log("[clean] 正在检查并清理残留的 Electron 进程与占用端口...");

if (isWin) {
  try {
    const p = spawn("taskkill", ["/F", "/IM", "electron.exe"], {
      stdio: "inherit",
      shell: true,
    });
    p.on("close", (code) => {
      if (code === 0) {
        console.log("[clean] 已清理残留的 electron.exe 进程。");
      } else {
        console.log("[clean] 没有发现运行中的 electron.exe 进程。");
      }
    });
  } catch (err) {
    console.warn("[clean] 执行 taskkill 异常:", err);
  }
} else {
  try {
    spawn("pkill", ["-f", "electron.*main.cjs"], { stdio: "inherit" });
    console.log("[clean] 已发送退出信号给残留进程。");
  } catch {}
}
