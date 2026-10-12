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
 * 接线：
 * - 鉴权：gateway.ts 与 universal 路由入口都直接（静态）导入 `requireAuth`，
 *   任何 /api/universal/* 请求（含 terminal/exec）没有有效 token 一律 401；
 *   PTY WebSocket 升级用 `gatewayAuthHeaders(req, { allowQueryToken: true })`。
 * - 前端拿 token：Electron 经 preload `acpStudio.getGatewayToken()`；浏览器模式
 *   打开网关启动日志里打印的 `/?token=...` 链接（前端存进 localStorage 后从地址栏抹掉），
 *   或在令牌页手动粘贴 `~/.acp-studio/.gateway-token` 的内容。见 src/lib/gateway-auth.ts。
 * - CORS：`corsHeaders(req)` 回显可信本地 Origin，不返回 `*`。
 * - 工作区：智能体写文件前调 `isPathAllowed(p, extraRoots)`，不在允许根内直接拒绝
 *  （见 .agents/rules/no-silent-fallbacks.md）。
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
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

/**
 * 浏览器模式的一次性登录链接（Jupyter 式）：`<base>/?token=<完整 token>`。
 * 只由 dev/独立网关入口（server/index.ts、server/node.ts）打印到本机终端，
 * 供用户点开浏览器 UI；前端读取后存入 localStorage 并从地址栏抹掉。
 * Electron 不打印（它经 preload 直接把 token 交给页面）。
 */
export function gatewayBootstrapUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/?token=${encodeURIComponent(ensureGatewayToken())}`;
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

export interface GatewayAuthOptions {
  /**
   * 允许从 URL `?token=` 读取凭证。只给 WebSocket 升级（PTY）用：浏览器的
   * WebSocket API 发不了自定义头。普通 HTTP 路由一律只认 Authorization 头，
   * 避免 token 出现在访问日志 / Referer 里。
   */
  allowQueryToken?: boolean;
}

/** 常量时间比较，避免按字节提前返回泄露 token 前缀。 */
function tokenEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function presentedToken(req: Request, opts: GatewayAuthOptions): { token: string; malformed: boolean } {
  const auth = (req.headers.get("authorization") || "").trim();
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    const t = (m ? m[1] : "").trim();
    return { token: t, malformed: !t };
  }
  if (opts.allowQueryToken) {
    try {
      const t = (new URL(req.url).searchParams.get("token") || "").trim();
      return { token: t, malformed: false };
    } catch (err) {
      console.warn(`[Security] 解析请求 URL 失败，按缺少 token 处理: ${(err as Error).message}`);
    }
  }
  return { token: "", malformed: false };
}

/**
 * 统一鉴权（gateway.ts、universal 路由与 PTY 升级共用）。三道关全部通过才放行：
 * 1. **必须**带正确的 token（`Authorization: Bearer <token>`；仅 WS 升级额外接受
 *    `?token=`）。缺失或错误一律 401——不再因为“没有 Origin 头”就放行
 *    （旧的 loopback-no-origin 规则让本机任何进程都能免 token 调 terminal/exec）。
 * 2. Host 必须是 loopback（防 DNS rebinding / 局域网 IP 直连）。
 * 3. 若带 Origin：只接受本地来源（http(s)://localhost|127.0.0.1|[::1]:*）或
 *    Electron file:// 的 "null"；带 Referer 但无 Origin 时同样校验 Referer。
 *    没有 Origin/Referer（curl、Electron 主进程、同源 GET）不额外拒绝，但第 1 关照样要过。
 */
export function gatewayAuthHeaders(req: Request, opts: GatewayAuthOptions = {}): GatewayAuthResult {
  const { token, malformed } = presentedToken(req, opts);
  if (malformed) return { ok: false, reason: "bad-bearer" };
  if (!token) return { ok: false, reason: "missing-token" };
  if (!tokenEquals(token, ensureGatewayToken())) return { ok: false, reason: "bad-token" };

  const host = requestHost(req);
  if (host && !isLoopbackHost(host)) {
    return { ok: false, reason: `non-loopback-host:${host}` };
  }
  const origin = (req.headers.get("origin") || "").trim();
  const referer = (req.headers.get("referer") || "").trim();
  if (origin) {
    if (origin === "null") return { ok: true, reason: "token-ok-electron-file-origin" };
    if (isTrustedOrigin(origin)) return { ok: true, reason: "token-ok-trusted-origin" };
    return { ok: false, reason: "untrusted-origin" };
  }
  if (referer) {
    try {
      const u = new URL(referer);
      if ((u.protocol === "http:" || u.protocol === "https:") && isLoopbackHost(u.hostname)) {
        return { ok: true, reason: "token-ok-trusted-referer" };
      }
    } catch {
      console.warn(`[Security] 非法 Referer 头已拒绝：${referer.slice(0, 120)}`);
    }
    return { ok: false, reason: "untrusted-referer" };
  }
  return { ok: true, reason: "token-ok-no-origin" };
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
    // gatewayUnauthorized 让前端区分“网关 token 不对”与智能体自身的 authRequired（同为 401）。
    { ok: false, error: "unauthorized: missing or invalid gateway token", gatewayUnauthorized: true },
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
