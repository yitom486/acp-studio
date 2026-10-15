/**
 * Runtime-agnostic HTTP gateway (Bun.serve AND Node/Hono compatible).
 * All routes speak WinterCG Request/Response only — no Bun.* / node:http APIs.
 * Entries: server/index.ts (Bun) and server/node.ts (Node, for Electron).
 */
import { Hono } from "hono";
import { handleUniversal } from "./universal/routes";
import { universalRegistry } from "./universal/registry";
import { corsHeaders as secureCorsHeaders, ensureGatewayToken, requireAuth } from "./universal/security";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { staticFileResponse } from "./static-files";
import { stopMcpUiServer } from "./universal/mcp-ui-server";

export function setupEnv() {
  // 生成/复用网关 token 并注入进程环境，同一机器前后端共享（详见 universal/security.ts）。
  const token = ensureGatewayToken();
  if (!process.env.ACP_GATEWAY_TOKEN) process.env.ACP_GATEWAY_TOKEN = token;

  // 确保在 Linux / WSL 环境下，PATH 始终优先包含 ~/.bun/bin 和 ~/.local/bin，
  // 避免子进程穿透到 Windows 挂载过来的 /mnt/c/... 中的 node.exe / npx 造成极端慢速与跨系统问题。
  if (process.platform === "linux") {
    const home = os.homedir();
    const bunBin = path.join(home, ".bun", "bin");
    const localBin = path.join(home, ".local", "bin");
    const existing = process.env.PATH || "";
    const parts = existing.split(path.delimiter);
    const toAdd = [bunBin, localBin, "/usr/local/bin"].filter((p) => !parts.includes(p) && fs.existsSync(p));
    if (toAdd.length > 0) {
      process.env.PATH = [...toAdd, existing].join(path.delimiter);
    }
  }
}

function parseArg(key: string): string | null {
  const idx = process.argv.indexOf(key);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

export const PORT = process.env.PORT
  ? parseInt(process.env.PORT)
  : parseArg("--port")
    ? parseInt(parseArg("--port")!)
    : 13005;

export const HOST = process.env.HOST || parseArg("--host") || "127.0.0.1";

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err);
});

console.log("[Server] Initializing Universal ACP Studio Gateway...");

/**
 * 受限 CORS（re-export，唯一实现在 universal/security.ts，避免循环依赖：
 * security.ts 不导入 gateway.ts）。不再返回 `*`，只回显可信本地 Origin。
 * 保留无参调用兼容（无请求时不设 Allow-Origin）。
 */
export function corsHeaders(req?: Request): Record<string, string> {
  return secureCorsHeaders(req);
}

/**
 * 安全版端口回收（替代旧的 taskkill 无差别强杀）：
 * 只杀同时满足两者的进程——① 进程名属于本项目运行时
 * （node.exe / bun.exe / electron.exe / acp-studio 系）② 健康检查通过
 * （http://127.0.0.1:port/api/universal/agents 返回 ok:true，确认为本项目旧网关）。
 * 任一条件不满足 → console.warn + throw Error("port occupied...") 让上层报错退出，
 * 绝不误杀用户其他进程（见 .agents/rules/no-silent-fallbacks.md：失败要 loud）。
 * 非 win32 直接返回（Unix 由调用方/SO_REUSEADDR 语义处理，不在此杀进程）。
 */
export async function freePortIfOccupied(port: number): Promise<void> {
  if (process.platform !== "win32") {
    try {
      const cmd = `fuser ${port}/tcp 2>/dev/null || lsof -ti :${port} 2>/dev/null || (ss -lptn 'sport = :${port}' 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2)`;
      const pidOut = execSync(cmd, { encoding: "utf8", shell: "/bin/sh" }).trim();
      const pids = pidOut
        .split(/\s+/)
        .map((p) => p.trim())
        .filter((p) => /^\d+$/.test(p) && p !== String(process.pid));
      for (const pid of pids) {
        try {
          process.kill(parseInt(pid, 10), "SIGKILL");
        } catch {}
      }
    } catch {}
    return;
  }
  let stdout: string;
  try {
    stdout = execSync(`netstat -ano | findstr /R /C:":${port} " | findstr LISTENING`, {
      encoding: "utf8",
      windowsHide: true,
    });
  } catch {
    return;
  }
  let pids: string[];
  try {
    pids = [
      ...new Set(
        stdout
          .trim()
          .split("\n")
          .map((l) => l.trim().split(/\s+/).pop() || "")
          // 只收纯数字 PID：既过滤表头，也杜绝 PID 拼进 shell 命令的注入面。
          .filter((pid) => /^\d+$/.test(pid) && pid !== "0" && pid !== String(process.pid))
      ),
    ];
  } catch (err) {
    console.warn(`[Server] 解析 netstat 输出失败，拒绝盲杀进程: ${(err as Error).message}`);
    throw new Error(`port ${port} occupied (netstat parse failed, refusing to kill blindly)`);
  }
  if (pids.length === 0) return;
  // 健康检查：只有本项目旧实例（带 token 请求返回 ok:true，或返回鉴权拒绝结构）才确认为残留网关。
  // 原生 in-process fetch：杜绝 curl.exe 命令行暴露 Bearer token。
  let healthy = false;
  try {
    const token = ensureGatewayToken();
    const res = await fetch(`http://127.0.0.1:${port}/api/universal/agents`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    const data = (await res.json().catch(() => null)) as any;
    healthy =
      res.status === 200 ||
      res.status === 401 ||
      (data && data.ok === true) ||
      (data && data.error && /(?:missing-token|invalid-token|unauthorized)/.test(data.error));
  } catch (err) {
    console.warn(`[Server] 端口 ${port} 健康检查探针不通，拒绝自动杀进程: ${(err as Error).message}`);
  }
  // 本项目运行时进程名（小写比对；acp studio 含空格，覆盖 electron-builder 打包名 "ACP Studio.exe"）。
  const OWN_EXE = new Set(["node.exe", "bun.exe", "electron.exe", "acp-studio.exe", "acp studio.exe"]);
  let killedAny = false;
  for (const pid of pids) {
    let image = "";
    try {
      const list = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: "utf8",
        windowsHide: true,
      });
      const m = /^"([^"]+)"/.exec(list.trim());
      image = (m ? m[1] : "").toLowerCase();
    } catch (err) {
      console.warn(`[Server] 查询 PID ${pid} 进程名失败，不杀该进程: ${(err as Error).message}`);
      continue;
    }
    if (!OWN_EXE.has(image)) {
      console.warn(
        `[Server] 端口 ${port} 被外部进程占用 PID ${pid} (${image || "unknown"})，拒绝误杀。请手动释放端口后重启。`
      );
      throw new Error(`port ${port} occupied by foreign process PID ${pid} (${image || "unknown"})`);
    }
    if (!healthy) {
      console.warn(
        `[Server] 端口 ${port} 被 ${image} PID ${pid} 占用，但健康检查未通过（无法确认为本项目旧网关），拒绝误杀。请手动确认后处理。`
      );
      throw new Error(`port ${port} occupied (owner ${image} PID ${pid} failed health check, refusing to kill)`);
    }
    console.log(`[Server] 端口 ${port} 残留旧网关 ${image} PID ${pid}（健康检查通过），taskkill 回收...`);
    try {
      execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: "ignore" });
      killedAny = true;
    } catch (err) {
      console.warn(`[Server] taskkill PID ${pid} 失败: ${(err as Error).message}`);
      throw new Error(`port ${port} occupied (failed to recycle stale gateway PID ${pid})`);
    }
  }
  if (killedAny) {
    // Allow Windows socket table up to 1 second to release the port
    for (let i = 0; i < 10; i++) {
      try {
        const check = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
          encoding: "utf8",
          windowsHide: true,
        });
        if (!check.trim()) break;
      } catch {
        // findstr 无匹配（exit 1）= 端口已释放，属期望的成功路径，直接跳出等待。
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export function buildApp() {
  const app = new Hono();

  // Universal ACP gateway (generic stdio agents: codex, gemini, claude, ...)
  app.all("/api/universal/*", async (c) => {
    // CORS 预检不带凭证、也不执行任何动作：只回 CORS 头（真正的请求照样要 token）。
    if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(c.req.raw) });
    // 先鉴权再进路由：401 直接返回（已带 CORS 头），不触及 handleUniversal。
    const denied = requireAuth(c.req.raw);
    if (denied) return denied;
    try {
      const universal = await handleUniversal(c.req.raw);
      if (universal) return universal;
    } catch (err: any) {
      console.error("[Server] universal gateway error:", err);
      return Response.json({ ok: false, error: err?.message || "universal gateway error" }, { status: 500, headers: corsHeaders(c.req.raw) });
    }
    return c.text("Not Found", 404);
  });

  app.options("*", (c) => new Response(null, { headers: corsHeaders(c.req.raw) }));

  // Static frontend (production/Electron): serve the public dir, SPA fallback.
  // Runtime-agnostic fs read so Bun and Node share this path.
  // ACP_PUBLIC_DIR overrides the default ./dist (Electron sets it to the
  // packaged app dir since cwd is not reliable there).
  const publicDir = () =>
    process.env.ACP_PUBLIC_DIR || path.join(process.cwd(), "dist");
  app.get("*", (c) => {
    const DIST = publicDir();
    const reqPath = new URL(c.req.url).pathname;
    if (reqPath.startsWith("/api/")) {
      return new Response("Not Found", { status: 404, headers: corsHeaders(c.req.raw) });
    }
    const rel = path.normalize(reqPath === "/" ? "/index.html" : reqPath).replace(/^([/\\])+/, "");
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file).toLowerCase();
        return staticFileResponse(c.req.raw, file, rel, MIME[ext] || "application/octet-stream");
      }
    } catch (err) {
      // 静态文件读取失败 → 回落 SPA index.html；此处 console.warn 留痕（loud 失败原则）。
      console.warn(`[Server] 静态文件读取失败，回落 index.html：${file}: ${(err as Error).message}`);
    }
    const index = path.join(DIST, "index.html");
    if (fs.existsSync(index)) {
      return staticFileResponse(c.req.raw, index, "index.html", "text/html; charset=utf-8");
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders(c.req.raw) });
  });

  return app;
}

export async function shutdownBridges() {
  await stopMcpUiServer().catch((err) => {
    console.warn(`[Server] 关闭 MCP UI 服务失败: ${(err as Error)?.message || err}`);
  });
  await universalRegistry.shutdown().catch((err) => {
    console.warn(`[Server] 关闭 agent 桥接失败：${(err as Error)?.message || err}`);
  });
}
