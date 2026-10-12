/**
 * 真 PTY 会话层（node-pty）：给终端抽屉提供可交互 shell。
 *
 * 为什么独立一层：
 * - node-pty 是 native 模块，Bun 下不可用 → isPtyAvailable() 守卫，
 *   Bun 网关（dev）走 501 + 前端回落 one-shot；Node 网关（dev:server:node
 *   / Electron 主进程）全功能。
 * - Windows 已知坑（社区 issue #827 一类）在此统一处理：
 *   ① env 全量继承（丢 SystemRoot 会导致 PowerShell 报 8009001d）；
 *   ② resize-after-exit 必须吞掉（ConPTY 句柄已死时 resize 会同步抛错，
 *   未捕获即崩整个网关进程）。
 *
 * 传输：WebSocket（见 attachPtyUpgrade），1 连接 = 1 pty，会话随连接生死，
 * 无需 GC。resize 走 HTTP POST（避免 WS 文本帧与控制帧的歧义）。
 */
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import type * as http from "node:http";
import type { Socket } from "node:net";
import { gatewayAuthHeaders } from "./security";

export const PTY_PATH = "/api/universal/terminal/pty";
export const PTY_MIN_COLS = 20;
export const PTY_MAX_COLS = 300;
export const PTY_MIN_ROWS = 5;
export const PTY_MAX_ROWS = 100;

export interface PtySize {
  cols: number;
  rows: number;
}

export interface PtySession {
  id: string;
  cwd: string;
  exited: boolean;
  exitCode: number | null;
  kill: () => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (code: number) => void) => void;
}

export type PtySpawner = (shell: string, args: string[], opts: Record<string, unknown>) => {
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
  readonly process: string;
};

/** 按平台选 shell（纯函数，可测）：Windows 走 ConPTY + PowerShell。 */
export function shellForPlatform(platform: string): { shell: string; args: string[] } {
  if (platform === "win32") return { shell: "powershell.exe", args: ["-NoLogo"] };
  return { shell: process.env.SHELL || "/bin/sh", args: [] };
}

/** 钳制终端尺寸（纯函数，可测）。 */
export function clampPtySize(cols: number, rows: number): PtySize {
  const c = Math.floor(Number(cols));
  const r = Math.floor(Number(rows));
  return {
    cols: Math.min(Math.max(Number.isFinite(c) ? c : 80, PTY_MIN_COLS), PTY_MAX_COLS),
    rows: Math.min(Math.max(Number.isFinite(r) ? r : 24, PTY_MIN_ROWS), PTY_MAX_ROWS),
  };
}

/** cwd 守卫（与 exec 端点同级：存在 + 是目录；真 shell 做不了命令 allowlist，见文件头）。 */
export function resolvePtyCwd(raw: string): { ok: true; cwd: string } | { ok: false; error: string } {
  const cwd = String(raw || "").trim();
  if (!cwd) return { ok: false, error: "cwd is required" };
  try {
    const resolved = path.resolve(cwd);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return { ok: false, error: "cwd 不存在或不是有效目录" };
    }
    return { ok: true, cwd: resolved };
  } catch (err: any) {
    return { ok: false, error: err.message || "cwd 校验失败" };
  }
}

const sessions = new Map<string, PtySession>();

function defaultSpawner(): PtySpawner | null {
  const impl = loadPtyImpl();
  if (!impl) return null;
  return (shell, args, opts) => impl.spawn(shell, args, opts as never) as never;
}

let ptyImpl: { spawn: PtySpawner } | null | undefined;
let ptyLoadError = "";
/** 最近一次加载失败原因（status 路由诚实透出，不编造）。 */
export function ptyUnavailableReason(): string {
  if ((process.versions as Record<string, string | undefined>)?.bun) {
    return "Bun 网关无 native node-pty，请切 dev:server:node 或用 Electron 内置网关";
  }
  return ptyLoadError || "node-pty 加载失败（原因未知）";
}
function loadPtyImpl(): { spawn: PtySpawner } | null {
  if (ptyImpl !== undefined) return ptyImpl;
  // Bun 无 native node-pty：直接不可用，不抛错（调用方回 501）。
  if ((process.versions as Record<string, string | undefined>)?.bun) {
    ptyImpl = null;
    return ptyImpl;
  }
  const attempts: Array<() => unknown> = [];
  try {
    // 双运行时解析：Electron main 是 Bun 打出的 CJS 包，裸 require 可用
    // （external 原样保留，相对 main.cjs 定位），优先走它；Node ESM
    //（server/node.ts、vitest）无 require，走 createRequire。
    // 注意：Bun 打包会把下行 import.meta.url 内联成编译期绝对路径，但该
    // 分支在包内永不可达（cjsRequire 恒真），仅 Node ESM 下是活代码。
    // 另注意：此处不可用 `module.require`——Bun 会把它改写成不存在的
    // `module_pty` 导致包内加载失败（已踩坑）。
    const cjsRequire =
      typeof require !== "undefined" ? (require as (id: string) => unknown) : undefined;
    const req = cjsRequire ?? createRequire(import.meta.url);
    attempts.push(() => req("node-pty"));
    // 正式包：native 在 app.asar.unpacked，asar 内代码的 require 解析
    // 不到它，必须按绝对路径直引（process.resourcesPath 只在 Electron 有）。
    const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
      const unpacked = path.join(resourcesPath, "app.asar.unpacked", "node_modules", "node-pty");
      attempts.push(() => req(unpacked));
    }
  } catch (err) {
    ptyLoadError = (err as Error).message;
    console.warn(`[PTY] node-pty 不可用（回落 one-shot）：${ptyLoadError}`);
    ptyImpl = null;
    return ptyImpl;
  }
  for (const run of attempts) {
    try {
      ptyImpl = run() as { spawn: PtySpawner };
      return ptyImpl;
    } catch (err) {
      ptyLoadError = (err as Error).message;
    }
  }
  console.warn(`[PTY] node-pty 不可用（回落 one-shot）：${ptyLoadError}`);
  ptyImpl = null;
  return ptyImpl;
}

/** node-pty 是否可用（Bun/缺 prebuild 时 false，前端据此回落）。 */
export function isPtyAvailable(): boolean {
  return loadPtyImpl() !== null;
}

/**
 * 建会话（spawner 可注入，单测用假 pty；生产走 defaultSpawner）。
 * resize 包了 exited 守卫 + try/catch：ConPTY 死后 resize 同步抛错，
 * 不吞即崩网关（社区 #827 同类問題）。
 */
export function createPtySession(
  id: string,
  cwd: string,
  size: PtySize,
  spawnFn?: PtySpawner | null
): PtySession {
  const spawn = spawnFn ?? defaultSpawner();
  if (!spawn) throw new Error("pty-unavailable");
  const { shell, args } = shellForPlatform(process.platform);
  const size0 = clampPtySize(size.cols, size.rows);
  const child = spawn(shell, args, {
    name: "xterm-256color",
    cwd,
    cols: size0.cols,
    rows: size0.rows,
    // 全量继承：Windows 丢 SystemRoot 会导致 PowerShell 启动失败（8009001d）。
    env: { ...process.env, TERM: "xterm-256color" },
  });
  const session: PtySession = {
    id,
    cwd,
    exited: false,
    exitCode: null,
    kill: () => {
      try {
        child.kill();
      } catch {
        // 已死：忽略
      }
    },
    write: (data) => {
      if (session.exited) return;
      try {
        child.write(data);
      } catch {
        // 写死管道：忽略，等 onExit 收尸
      }
    },
    resize: (cols, rows) => {
      if (session.exited) return;
      const s = clampPtySize(cols, rows);
      try {
        child.resize(s.cols, s.rows);
      } catch {
        // resize-after-exit 竞态：吞掉（句柄已死，调也没意义）
      }
    },
    onData: (cb) => child.onData(cb),
    onExit: (cb) =>
      child.onExit((e) => {
        session.exited = true;
        session.exitCode = e.exitCode;
        cb(e.exitCode);
      }),
  };
  sessions.set(id, session);
  return session;
}

export function getPtySession(id: string): PtySession | undefined {
  return sessions.get(id);
}

export function destroyPtySession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  s.kill();
}

/** 进程退出兜底：子 shell 不随网关陪葬（Windows 尤其会 lingering）。 */
try {
  process.on("exit", () => {
    for (const [, s] of sessions) {
      try {
        s.kill();
      } catch {
        // 退出路径：忽略
      }
    }
  });
} catch {
  // 非 Node 运行时（Bun 无此需求）：忽略
}

interface UpgradeHead {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
}

/**
 * 把 WS 升级挂到 Node http.Server（server/node.ts 与 Electron main.ts 调；
 * Bun.serve 的 server/index.ts 不调——Bun 下无 pty，status 路由回 501）。
 * 鉴权复用 gatewayAuthHeaders（token 必填 + loopback/Origin 规则与 HTTP 一致；
 * WS 浏览器发不了自定义头，token 走 `?token=` 查询参数）。
 */
export async function attachPtyUpgrade(server: http.Server): Promise<void> {
  const { WebSocketServer } = await import("ws");
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req: UpgradeHead & { headers: Record<string, string | undefined> }, socket: Socket, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url || "", `http://${req.headers.host || "127.0.0.1"}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== PTY_PATH) return; // 非 PTY 升级：不归我们管
    // 浏览器 WebSocket 发不了 Authorization 头：额外接受 `?token=`（仅此升级路径）。
    const check = gatewayAuthHeaders(
      new Request(url.toString(), {
        headers: {
          ...(req.headers.host ? { host: req.headers.host } : {}),
          ...(req.headers.origin ? { origin: req.headers.origin as string } : {}),
          ...(req.headers.authorization ? { authorization: req.headers.authorization as string } : {}),
        },
      }),
      { allowQueryToken: true }
    );
    if (!check.ok) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!isPtyAvailable()) {
      socket.write("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const cwdCheck = resolvePtyCwd(url.searchParams.get("cwd") || "");
    if (!cwdCheck.ok) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const ptyId = (url.searchParams.get("ptyId") || "").slice(0, 64) || `pty-${Date.now()}`;
    const size = clampPtySize(
      parseInt(url.searchParams.get("cols") || "80", 10),
      parseInt(url.searchParams.get("rows") || "24", 10)
    );
    wss.handleUpgrade(req as never, socket, head, (ws) => {
      let session: PtySession;
      try {
        // 同 id 重连：先杀旧会话（抽屉重连按钮走此路径）。
        destroyPtySession(ptyId);
        session = createPtySession(ptyId, cwdCheck.cwd, size);
      } catch (err) {
        ws.close(1011, (err as Error).message || "pty spawn failed");
        return;
      }
      session.onData((data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      });
      session.onExit((code) => {
        try {
          if (ws.readyState === ws.OPEN) ws.send(`\r\n\x1b[90m[shell exited ${code}]\x1b[0m\r\n`);
        } catch {
          // 关闭中：忽略
        }
        try {
          ws.close(1000, `exited-${code}`);
        } catch {
          // 忽略
        }
        sessions.delete(ptyId);
      });
      // 客户端 → pty：全量透传（shell 自己回显；Ctrl+C 即 \x03 即 SIGINT）。
      ws.on("message", (msg: Buffer) => {
        session.write(msg.toString());
      });
      ws.on("close", () => destroyPtySession(ptyId));
      ws.on("error", () => destroyPtySession(ptyId));
    });
  });
}
