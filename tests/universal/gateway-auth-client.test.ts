/**
 * 前端令牌接线（src/lib/gateway-auth.ts）：取 token 的优先级、地址栏抹除、
 * 请求头 / WS 查询串注入、401 判定。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  GATEWAY_TOKEN_STORAGE_KEY,
  apiFetch,
  bootstrapGatewayToken,
  clearGatewayToken,
  getGatewayToken,
  verifyGatewayToken,
  withTokenQuery,
} from "@/lib/gateway-auth";

const realFetch = globalThis.fetch;

beforeEach(() => {
  clearGatewayToken();
  delete (window as any).acpStudio;
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (window as any).acpStudio;
});

describe("gateway token bootstrap", () => {
  it("reads ?token= from the address bar, persists it, then strips it from the URL", async () => {
    window.history.replaceState(null, "", "/?token=abc123&x=1#h");
    expect(await bootstrapGatewayToken()).toBe("abc123");
    expect(localStorage.getItem(GATEWAY_TOKEN_STORAGE_KEY)).toBe("abc123");
    expect(window.location.search).toBe("?x=1");
    expect(window.location.hash).toBe("#h");
  });

  it("falls back to the stored token on later loads", async () => {
    localStorage.setItem(GATEWAY_TOKEN_STORAGE_KEY, "stored-token");
    expect(await bootstrapGatewayToken()).toBe("stored-token");
  });

  it("prefers the Electron preload token and does not persist it", async () => {
    localStorage.setItem(GATEWAY_TOKEN_STORAGE_KEY, "stale");
    (window as any).acpStudio = { platform: "linux", versions: {}, getGatewayToken: async () => "from-electron" };
    expect(await bootstrapGatewayToken()).toBe("from-electron");
    expect(getGatewayToken()).toBe("from-electron");
    expect(localStorage.getItem(GATEWAY_TOKEN_STORAGE_KEY)).toBe("stale");
  });

  it("returns null when no source has a token", async () => {
    expect(await bootstrapGatewayToken()).toBeNull();
  });
});

describe("token injection", () => {
  it("apiFetch adds Authorization and keeps caller headers", async () => {
    localStorage.setItem(GATEWAY_TOKEN_STORAGE_KEY, "tkn");
    await bootstrapGatewayToken();
    const spy = vi.fn(async () => new Response("{}"));
    globalThis.fetch = spy as unknown as typeof fetch;
    await apiFetch("/api/universal/agents", { headers: { "Content-Type": "application/json" } });
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1];
    const h = new Headers(init.headers);
    expect(h.get("Authorization")).toBe("Bearer tkn");
    expect(h.get("Content-Type")).toBe("application/json");
  });

  it("withTokenQuery appends the token for WebSocket URLs", async () => {
    localStorage.setItem(GATEWAY_TOKEN_STORAGE_KEY, "a b");
    await bootstrapGatewayToken();
    expect(withTokenQuery("ws://h/api/universal/terminal/pty?ptyId=1")).toBe("ws://h/api/universal/terminal/pty?ptyId=1&token=a%20b");
  });
});

describe("verifyGatewayToken", () => {
  it("maps gateway 401 to unauthorized, agent 401 / 200 to ok, network error to unreachable", async () => {
    globalThis.fetch = (async () => Response.json({ ok: false, gatewayUnauthorized: true }, { status: 401 })) as typeof fetch;
    expect(await verifyGatewayToken()).toBe("unauthorized");
    globalThis.fetch = (async () => Response.json({ ok: false, authRequired: true }, { status: 401 })) as typeof fetch;
    expect(await verifyGatewayToken()).toBe("ok");
    globalThis.fetch = (async () => Response.json({ ok: true })) as typeof fetch;
    expect(await verifyGatewayToken()).toBe("ok");
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await verifyGatewayToken()).toBe("unreachable");
  });
});
