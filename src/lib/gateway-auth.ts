/**
 * 网关访问令牌（gateway token）的前端一侧。
 *
 * 网关对所有 /api/universal/* 强制 `Authorization: Bearer <token>`
 * （server/universal/security.ts），这里负责拿到 token 并在每个请求上带上：
 *
 * 1. Electron：preload 透出 `window.acpStudio.getGatewayToken()`（主进程直接给）。
 * 2. 浏览器：网关启动日志打印的 `/?token=...` 一次性链接 → 存 localStorage，
 *    并立刻从地址栏抹掉（不留在历史记录 / 截图里）。
 * 3. 浏览器：令牌页手动粘贴 `~/.acp-studio/.gateway-token` 的内容（GatewayTokenGate）。
 *
 * 传输层保持哑巴（state_management.md 第三条）：这里只持有 token 本身，
 * 不缓存任何业务数据。
 */

export const GATEWAY_TOKEN_STORAGE_KEY = "acp_gateway_token";

let token: string | null = null;

function readStored(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const t = (localStorage.getItem(GATEWAY_TOKEN_STORAGE_KEY) || "").trim();
    return t || null;
  } catch (err) {
    console.warn("[GatewayAuth] 读取 localStorage 失败，需重新输入令牌:", err);
    return null;
  }
}

/** 当前 token（未拿到时为 null）。 */
export function getGatewayToken(): string | null {
  return token ?? readStored();
}

/** 记住 token（浏览器模式落 localStorage；Electron 每次启动由主进程给，不落盘）。 */
export function setGatewayToken(t: string, persist = true): void {
  token = t.trim() || null;
  if (!persist) return;
  try {
    if (typeof localStorage === "undefined") return;
    if (token) localStorage.setItem(GATEWAY_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(GATEWAY_TOKEN_STORAGE_KEY);
  } catch (err) {
    console.warn("[GatewayAuth] 写入 localStorage 失败，令牌只在本次页面有效:", err);
  }
}

export function clearGatewayToken(): void {
  setGatewayToken("", true);
}

/**
 * 启动时取 token：Electron preload > 地址栏 `?token=` > localStorage。
 * 地址栏里的 token 读完立刻用 history.replaceState 抹掉。
 */
export async function bootstrapGatewayToken(): Promise<string | null> {
  if (typeof window !== "undefined" && window.acpStudio?.getGatewayToken) {
    const t = await window.acpStudio.getGatewayToken();
    setGatewayToken(t, false);
    return getGatewayToken();
  }
  if (typeof window !== "undefined" && window.location) {
    const url = new URL(window.location.href);
    const fromUrl = (url.searchParams.get("token") || "").trim();
    if (fromUrl) {
      setGatewayToken(fromUrl);
      url.searchParams.delete("token");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      return fromUrl;
    }
  }
  token = readStored();
  return token;
}

/** 给 fetch init 补上 Authorization 头（调用方自带的头保留）。 */
export function withGatewayAuth(init?: RequestInit): RequestInit {
  const t = getGatewayToken();
  if (!t) return init ?? {};
  const headers = new Headers(init?.headers);
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  return { ...(init ?? {}), headers };
}

/** 访问网关的 fetch：自动带 token。所有 /api/universal/* 调用都必须走它。 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, withGatewayAuth(init));
}

/** WebSocket 发不了自定义头：把 token 拼进查询串（网关只在 PTY 升级路径接受）。 */
export function withTokenQuery(url: string): string {
  const t = getGatewayToken();
  if (!t) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(t)}`;
}

export type GatewayAuthState = "ok" | "unauthorized" | "unreachable";

/**
 * 校验当前 token：401 且带 gatewayUnauthorized → "unauthorized"（显示令牌页）；
 * 网关没起 / 网络错 → "unreachable"（照常进应用，由各处请求自己报错）。
 */
export async function verifyGatewayToken(): Promise<GatewayAuthState> {
  let res: Response;
  try {
    res = await apiFetch("/api/universal/agents");
  } catch (err) {
    console.warn("[GatewayAuth] 网关不可达，先进入应用（请求会各自报错）:", err);
    return "unreachable";
  }
  if (res.status !== 401) return "ok";
  const body = (await res.json().catch(() => null)) as { gatewayUnauthorized?: boolean } | null;
  return body?.gatewayUnauthorized ? "unauthorized" : "ok";
}
