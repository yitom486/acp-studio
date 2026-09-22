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

export function setupEnv() {
  // 生成/复用网关 token 并注入进程环境，同一机器前后端共享（详见 universal/security.ts）。
  const token = ensureGatewayToken();
  if (!process.env.ACP_GATEWAY_TOKEN) process.env.ACP_GATEWAY_TOKEN = token;
}

export const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3004;

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
export function freePortIfOccupied(port: number) {
  if (process.platform !== "win32") return;
  let stdout: string;
  try {
    stdout = execSync(`netstat -ano | findstr /R /C:":${port} " | findstr LISTENING`, {
      encoding: "utf8",
      windowsHide: true,
    });
  } catch {
    // findstr 无匹配时 exit 1 → 端口空闲。这是确定性无害路径，直接返回
    //（error_handling.md 允许此类位置不打 warn；见该文件“deterministically 无害”条）。
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
  // 健康检查：只有本项目旧实例（/api/universal/agents 返回 ok:true）才可能是残留网关。
  let healthy = false;
  try {
    const probe = execSync(`curl.exe -s -m 3 http://127.0.0.1:${port}/api/universal/agents`, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
    healthy = /"ok"\s*:\s*true/.test(probe);
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
        return new Response(fs.readFileSync(file), {
          headers: { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" },
        });
      }
    } catch (err) {
      // 静态文件读取失败 → 回落 SPA index.html；此处 console.warn 留痕（loud 失败原则）。
      console.warn(`[Server] 静态文件读取失败，回落 index.html：${file}: ${(err as Error).message}`);
    }
    const index = path.join(DIST, "index.html");
    if (fs.existsSync(index)) {
      return new Response(fs.readFileSync(index), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders(c.req.raw) });
  });

  return app;
}

export async function shutdownBridges() {
  await universalRegistry.shutdown().catch((err) => {
    console.warn(`[Server] 关闭 agent 桥接失败：${(err as Error)?.message || err}`);
  });
}
