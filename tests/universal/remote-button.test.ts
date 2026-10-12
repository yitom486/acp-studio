/**
 * 底部状态栏远程角标（RemoteButton + StatusBar）：三态标签、菜单、WSL 菜单项。
 * fetch 全局 mock（wsl-distros + workspace validate），window.prompt mock。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "@/components/universal/StatusBar";
import { useStudioStore } from "@/stores/useStudioStore";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { setGatewayBase } from "@/lib/gateway-auth";

const realFetch = globalThis.fetch;
const realPrompt = window.prompt;

function fetchMock() {
  globalThis.fetch = (async (input: unknown) => {
    const u = String(input);
    if (u.includes("/workspace/wsl-distros")) return Response.json({ ok: true, distros: ["Ubuntu", "Debian"] });
    return Response.json({ ok: false, error: "unexpected" }, { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  fetchMock();
  setGatewayBase("");
  useStudioStore.setState({ currentWorkspace: null, recentWorkspaces: [] } as any);
  useWorkbenchStore.setState({ settingsOpen: false });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  window.prompt = realPrompt;
  setGatewayBase("");
  useStudioStore.setState({ currentWorkspace: null, recentWorkspaces: [] } as any);
  useWorkbenchStore.setState({ settingsOpen: false });
});

async function renderBar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(h(QueryClientProvider, { client: qc }, h(StatusBar, null)));
    await new Promise((r) => setTimeout(r, 50));
  });
  return { el, root, qc };
}

function cornerButton(el: HTMLElement): HTMLButtonElement | null {
  return Array.from(el.querySelectorAll("button")).find((b) =>
    (b.getAttribute("aria-label") || "").startsWith("当前环境")
  ) as HTMLButtonElement || null;
}

describe("StatusBar remote corner", () => {
  it("shows 本机 locally, opens a menu with WSL distros", async () => {
    const { el, root, qc } = await renderBar();
    expect(cornerButton(el)?.textContent).toContain("本机");
    await act(async () => {
      cornerButton(el)?.click();
      await new Promise((r) => setTimeout(r, 100));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const menu = el.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain("本机");
    expect(menu?.textContent).toContain("WSL: Ubuntu");
    expect(menu?.textContent).toContain("WSL: Debian");
    expect(menu?.textContent).toContain("远端网关");
    root.unmount();
    el.remove();
    qc.clear();
  });

  it("shows WSL: <distro> when the workspace is inside WSL", async () => {
    useStudioStore.setState({ currentWorkspace: "\\\\wsl$\\Ubuntu\\home\\u\\proj" } as any);
    const { el, root, qc } = await renderBar();
    expect(cornerButton(el)?.textContent).toContain("WSL: Ubuntu");
    root.unmount();
    el.remove();
    qc.clear();
  });

  it("shows the remote host when a custom base is set", async () => {
    setGatewayBase("http://127.0.0.1:4004");
    const { el, root, qc } = await renderBar();
    expect(cornerButton(el)?.textContent).toContain("127.0.0.1:4004");
    root.unmount();
    el.remove();
    qc.clear();
  });

  it("recent WSL workspaces appear under their distro", async () => {
    useStudioStore.setState({
      currentWorkspace: "D:\\r",
      recentWorkspaces: [{ path: "\\\\wsl$\\Ubuntu\\home\\u\\proj", name: "proj", lastOpened: 1 }],
    } as any);
    const { el, root, qc } = await renderBar();
    await act(async () => {
      cornerButton(el)?.click();
      await new Promise((r) => setTimeout(r, 100));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(el.querySelector('[role="menu"]')?.textContent).toContain("proj");
    root.unmount();
    el.remove();
    qc.clear();
  });

  it("does not crash when prompt is cancelled", async () => {
    window.prompt = vi.fn(() => null) as any;
    const { el, root, qc } = await renderBar();
    await act(async () => {
      cornerButton(el)?.click();
      await new Promise((r) => setTimeout(r, 150));
    });
    const wslRow = Array.from(el.querySelectorAll('[role="menuitem"]')).find((b) =>
      (b.textContent || "").includes("WSL: Ubuntu")
    ) as HTMLButtonElement | undefined;
    expect(wslRow).toBeTruthy();
    await act(async () => {
      wslRow?.click();
    });
    expect(window.prompt).toHaveBeenCalled();
    root.unmount();
    el.remove();
    qc.clear();
  });
});
