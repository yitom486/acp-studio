import * as fs from "node:fs";

/**
 * 删除测试临时目录。Windows 上刚退出的子进程（PowerShell / node-pty）可能还
 * 短暂占着 cwd，导致 rmdir 报 EBUSY/EPERM；先按 Node 自带重试删，仍失败时
 * 在 Windows 上只告警不报错（目录在系统临时目录里，CI 机器用完即弃），
 * 其他平台照常抛出，避免掩盖真实问题。
 */
export function rmTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (process.platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY")) {
      console.warn(`[tests] 临时目录仍被占用，留给系统清理：${dir} (${code})`);
      return;
    }
    throw err;
  }
}
