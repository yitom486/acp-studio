/**
 * 本地网关安全边界（loopback-only + token + 受限 CORS + 工作区 allowlist）。
 *
 * 背景（分析报告第1项：CORS `*` + 第4项后半：端口误杀）：
 * - 网关只监听 127.0.0.1（见 server/index.ts / server/node.ts / desktop/main.ts），
 *   本文件做纵深防御：即使监听被改动，鉴权与 CORS 依然要求本地来源或 Bearer token。
 * - 旧的 `Access-Control-Allow-Origin: *` 已移除，改为只回显可信本地 Origin。
 * - 旧的 taskkill 强杀端口逻辑已收敛为 server/gateway.ts::freePortIfOccupied（安全版：
 *   只杀“进程名匹配 + 健康检查通过”的本项目旧实例，否则 loud 报错退出）。
 *
 * 给 routes.ts 的接线说明（routes.ts 由另一 agent 负责，本文件只提供导出，不主动改它）：
 * - 鉴权：在 handleUniversal 入口调用 `requireGatewayAuth(req)`（= `requireAuth` 别名），
 *   返回非 null 时直接返回该 401 Response（已带 CORS 头）。
 * - CORS：把 routes.ts 顶部自带的 `corsHeaders()` 换成从本模块导入的
 *   `corsHeaders(req)`（回显可信 Origin，不再返回 `*`）。
 * - 工作区：在访问文件系统 / git / 终端 cwd 前调用 `isPathAllowed(p)`，
 *   不在 allowlist 内直接 400/403 loud 报错（见 .agents/rules/no-silent-fallbacks.md）。
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Gateway token
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;

/** token 落盘位置（同一机器前后端共享的关键）。 */
export function gatewayTokenPath(): string {
  return path.join(os.homedir(), ".acp-studio", ".gateway-token");
}

function isValidTokenFormat(t: string): boolean {
  return /^[0-9a-f]{64}$/.test(t);
}

/**
 * 首次启动随机生成 32 字节 hex token，缓存在内存 + 写入
 * `~/.acp-studio/.gateway-token`（mode 600），下次复用；
 * 允许 `ACP_GATEWAY_TOKEN` 环境变量覆盖（Electron 主进程在 createWindow 前
 * 写入该环境变量；CI/多实例也可用它固定 token）。
 *
 * 磁盘读写失败时 loud warn 并降级为内存临时 token（重启后失效），绝不静默吞错。
 */
export function ensureGatewayToken(): string {
  if (cachedToken) return cachedToken;
  const fromEnv = (process.env.ACP_GATEWAY_TOKEN || "").trim();
  if (fromEnv) {
    // 环境覆盖：直接采用（格式不强制，便于测试与外部注入）。
    cachedToken = fromEnv;
    return cachedToken;
  }
  const file = gatewayTokenPath();
  try {
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, "utf8").trim();
      if (isValidTokenFormat(saved)) {
        cachedToken = saved;
        return cachedToken;
      }
      console.warn(`[Security] gateway token 文件格式非法（期望64位hex），将重新生成覆盖：${file}`);
    }
  } catch (err) {
    console.warn(
      `[Security] 读取 gateway token 文件失败，将使用内存临时 token（重启后失效）：${file}: ${(err as Error).message}`
    );
  }
  const fresh = randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fresh + "\n", { mode: 0o600 });
  } catch (err) {
    console.warn(
      `[Security] 写入 gateway token 文件失败，将使用内存临时 token（重启后失效）：${file}: ${(err as Error).message}`
    );
  }
  cachedToken = fresh;
  return cachedToken;
}

/**
 * 只用于启动日志：前8位 + 掩码。禁止把完整 token 打进日志，
 * 完整 token 只存在 ~/.acp-studio/.gateway-token（或 ACP_GATEWAY_TOKEN 环境变量）里。
 */
export function gatewayTokenPreview(): string {
  const t = ensureGatewayToken();
  return `${t.slice(0, 8)}…(masked, ${t.length} chars)`;
}

/** 清掉内存缓存（单测复用；生产代码不要调用）。 */
export function resetGatewayTokenCache(): void {
  cachedToken = null;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase().replace(/^\[|\]$/g, ""));
}

function requestHost(req: Request): string {
  const h = (req.headers.get("host") || "").trim().toLowerCase();
  if (h) {
    // 去掉端口；IPv6 形如 [::1]:3004。
    if (h.startsWith("[")) {
      const end = h.indexOf("]");
      return end >= 0 ? h.slice(1, end) : h;
    }
    return h.split(":")[0] || "";
  }
  try {
    return new URL(req.url).hostname.toLowerCase();
  } catch (err) {
    // URL 非法时按最严格处理：视为非 loopback（必须 Bearer）。
    console.warn(`[Security] 解析请求 URL 失败，按非 loopback 处理（要求 Bearer）: ${(err as Error).message}`);
    return "";
  }
}

/**
 * 可信 Origin：http/https + loopback 主机。端口不限——5188（vite）、
 * 3004（网关）及自定义本地端口同属一台机器，一律信任。
 * 注意：Opaque Origin "null"（沙箱 file://）不在此列，由鉴权函数单独放行，
 * CORS 头里不回显 "null"。
 */
export function isTrustedOrigin(origin: string): boolean {
  const o = origin.trim();
  if (!o || o === "null") return false;
  try {
    const u = new URL(o);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return isLoopbackHost(u.hostname);
  } catch {
    console.warn(`[Security] 非法 Origin 头已拒绝：${o.slice(0, 120)}`);
    return false;
  }
}

export interface GatewayAuthResult {
  ok: boolean;
  reason: string;
}

/**
 * 统一鉴权（gateway.ts 与 routes.ts 共用），顺序即优先级：
 * 1. `Authorization: Bearer <token>` 正确 → 放行（任何 Origin）。
 *    注意：带了错误的 Bearer 直接 401，不再看 Origin（伪造凭证必须 loud 拒绝，
 *    不能回落到来源放行）。
 * 2. Host 非 loopback（DNS rebinding / 局域网 IP 直连）→ 除 Bearer 外一律 401，
 *    即使 Origin 缺失也不放行。
 * 3. Host 为 loopback 时：Origin/Referer 缺失（curl、同源 GET、Electron file://）
 *    或 Origin 为 "null"（沙箱 file://）或 Origin/Referer 为本地来源
 *    （http://localhost:* / http://127.0.0.1:*）→ 放行；其余 401。
 */
export function gatewayAuthHeaders(req: Request): GatewayAuthResult {
  const auth = (req.headers.get("authorization") || "").trim();
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    const presented = (m ? m[1] : "").trim();
    if (presented && presented === ensureGatewayToken()) {
      return { ok: true, reason: "bearer-ok" };
    }
    return { ok: false, reason: "bad-bearer" };
  }
  const host = requestHost(req);
  if (host && !isLoopbackHost(host)) {
    return { ok: false, reason: `non-loopback-host:${host}` };
  }
  const origin = (req.headers.get("origin") || "").trim();
  const referer = (req.headers.get("referer") || "").trim();
  if (!origin && !referer) return { ok: true, reason: "loopback-no-origin" };
  if (origin === "null") return { ok: true, reason: "electron-file-null-origin" };
  if (origin && isTrustedOrigin(origin)) return { ok: true, reason: "loopback-trusted-origin" };
  if (!origin && referer) {
    try {
      const u = new URL(referer);
      if ((u.protocol === "http:" || u.protocol === "https:") && isLoopbackHost(u.hostname)) {
        return { ok: true, reason: "loopback-trusted-referer" };
      }
    } catch {
      console.warn(`[Security] 非法 Referer 头已拒绝：${referer.slice(0, 120)}`);
    }
    return { ok: false, reason: "untrusted-referer" };
  }
  return { ok: false, reason: "untrusted-origin" };
}

/** 语义别名：与 gatewayAuthHeaders 等价，供 routes agent 按意图选用。 */
export const checkGatewayAuth = gatewayAuthHeaders;

function safePath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "<bad-url>";
  }
}

/**
 * 网关入口包装：鉴权通过返回 null，不通过返回 401 Response（已带 CORS 头）。
 * gateway.ts 的 `/api/universal/*` 在调用 handleUniversal 之前先调它；
 * routes.ts 如需在路由层二次校验也调它（别名 requireGatewayAuth）。
 */
export function requireAuth(req: Request): Response | null {
  let check: GatewayAuthResult;
  try {
    check = gatewayAuthHeaders(req);
  } catch (err) {
    console.error(`[Security] 鉴权检查异常，默认拒绝：${(err as Error).message}`);
    return Response.json({ ok: false, error: "gateway auth check failed" }, { status: 401, headers: corsHeaders(req) });
  }
  if (check.ok) return null;
  console.warn(`[Security] 拒绝未授权的网关请求 ${req.method} ${safePath(req)}（${check.reason}）。`);
  return Response.json(
    { ok: false, error: "unauthorized: missing or invalid gateway token" },
    { status: 401, headers: corsHeaders(req) }
  );
}

/** routes.ts 接线别名：与 requireAuth 完全等价。 */
export const requireGatewayAuth = requireAuth;

// ---------------------------------------------------------------------------
// CORS（受限回显，替代旧的 `*`）
// ---------------------------------------------------------------------------

const ALLOW_METHODS = "GET, POST, DELETE, OPTIONS";
const ALLOW_HEADERS = "Content-Type, Authorization";

/**
 * 受限 CORS：不再返回 `*`。只当请求携带可信本地 Origin
 * （http(s)://localhost:* / http(s)://127.0.0.1:*，含 5188/3004）时才回显该 Origin；
 * 无 Origin（curl / 同源 / Electron file://）或不可信 Origin 时不设
 * Access-Control-Allow-Origin（同源请求不需要它，非浏览器请求不受 CORS 约束）。
 * 恒带 `Vary: Origin`，保留 Allow-Methods/Headers。
 */
export function corsHeaders(req?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    Vary: "Origin",
  };
  try {
    const origin = req?.headers.get("origin")?.trim() || "";
    if (origin && origin !== "null" && isTrustedOrigin(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
  } catch (err) {
    console.warn(`[Security] 生成 CORS 头失败（已降级为不回显 Origin）：${(err as Error).message}`);
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Workspace allowlist
// ---------------------------------------------------------------------------

/**
 * 切分 ACP_WORKSPACE_ROOTS：`;` 恒为分隔符；`:` 也是分隔符（Unix 风格），
 * 但 Windows 盘符冒号（如 `C:\x` / `C:/x`）必须整体保留，不能切。
 */
function splitWorkspaceRoots(raw: string): string[] {
  const out: string[] = [];
  for (const semi of raw.split(";")) {
    const s = semi.trim();
    if (!s) continue;
    if (/^[A-Za-z]:(?:[\\/]|$)/.test(s)) {
      out.push(s);
      continue;
    }
    for (const c of s.split(":")) {
      const t = c.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * 工作区 allowlist：`ACP_WORKSPACE_ROOTS`（`;` 或 `:` 分隔，Windows/Unix 通用；
 * 盘符冒号不切分，见 splitWorkspaceRoots）追加 `process.cwd()` 默认根；
 * 全部规范化为绝对路径并去重。
 */
export function getWorkspaceRoots(): string[] {
  const parts = splitWorkspaceRoots(process.env.ACP_WORKSPACE_ROOTS || "");
  const roots: string[] = [];
  const push = (p: string) => {
    try {
      const abs = path.resolve(p);
      if (!roots.includes(abs)) roots.push(abs);
    } catch (err) {
      console.warn(`[Security] 非法工作区根已忽略 ${p}：${(err as Error).message}`);
    }
  };
  for (const p of parts) push(p);
  push(process.cwd());
  return roots;
}

function normForCompare(p: string): string {
  const abs = path.resolve(p);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

/**
 * 规范化后前缀匹配：等于某根或位于某根之内才允许。
 * 空路径 / 规范化失败一律返回 false（默认拒绝，不静默放行）。
 */
export function isPathAllowed(p: string): boolean {
  if (!p || !p.trim()) return false;
  let target: string;
  try {
    target = normForCompare(p);
  } catch (err) {
    console.warn(`[Security] 路径规范化失败，默认拒绝 ${p}：${(err as Error).message}`);
    return false;
  }
  for (const r of getWorkspaceRoots()) {
    const root = process.platform === "win32" ? r.toLowerCase() : r;
    if (target === root || target.startsWith(root + path.sep)) return true;
  }
  return false;
}
