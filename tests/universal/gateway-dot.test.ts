/**
 * 顶栏网关健康点（GatewayDot）：三态颜色、tooltip、点击进网关设置页。
 * QueryClient 现配，fetch 全局 mock。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GatewayDot, healthDotClass } from "@/components/universal/GatewayDot";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  useWorkbenchStore.setState({ settingsOpen: false, settingsTab: "general" });
});

describe("healthDotClass", () => {
  it("maps ok/warn/bad/fetching", () => {
    expect(healthDotClass("ok", false)).toContain("bg-success");
    expect(healthDotClass("unauthorized", false)).toContain("bg-warning");
    expect(healthDotClass("unreachable", false)).toContain("bg-destructive");
    expect(healthDotClass(undefined, false)).toContain("animate-pulse");
    expect(healthDotClass("ok", true)).toContain("animate-pulse");
  });
});

describe("GatewayDot", () => {
  async function renderDot() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(h(QueryClientProvider, { client: qc }, h(GatewayDot, null)));
      await new Promise((r) => setTimeout(r, 100));
    });
    // 第二轮把 query 落盘后的 rerender 刷出来（仓内既定模式）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    return { el, root, qc };
  }

  it("shows ok state and opens gateway settings on click", async () => {
    globalThis.fetch = (async () => Response.json({ ok: true })) as typeof fetch;
    const { el, root, qc } = await renderDot();
    const btn = el.querySelector("button");
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute("title") || "").toContain("网关正常");
    await act(async () => {
      btn?.click();
    });
    const st = useWorkbenchStore.getState();
    expect(st.settingsOpen).toBe(true);
    expect(st.settingsTab).toBe("gateway");
    root.unmount();
    el.remove();
    qc.clear();
  });

  it("shows unreachable when the gateway is down", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const { el, root, qc } = await renderDot();
    expect(el.querySelector("button")?.getAttribute("title") || "").toContain("不可达");
    root.unmount();
    el.remove();
    qc.clear();
  });
});
