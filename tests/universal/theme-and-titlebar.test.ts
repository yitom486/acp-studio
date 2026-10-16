import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToString as renderHtml } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useThemeStore, THEMES, type ThemeId } from "@/stores/useThemeStore";
import { TitleBar } from "@/components/universal/TitleBar";
import { StudioHeader } from "@/components/universal/StudioHeader";

const renderToString = (element: Parameters<typeof renderHtml>[0]) =>
  renderHtml(React.createElement(QueryClientProvider, { client: new QueryClient() }, element));

describe("Theme Store & Window TitleBar & StudioHeader", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
  });

  it("provides valid presets for all 4 brightness themes", () => {
    const keys: ThemeId[] = ["dark", "oled", "dim", "light"];
    for (const key of keys) {
      const meta = THEMES[key];
      expect(meta).toBeDefined();
      expect(meta.id).toBe(key);
      expect(meta.name).toBeTruthy();
      expect(meta.overlayColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(meta.overlaySymbolColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("updates DOM data-theme attribute and dark class when switching themes", () => {
    const store = useThemeStore.getState();

    // Switch to oled
    store.setTheme("oled");
    expect(useThemeStore.getState().theme).toBe("oled");
    expect(document.documentElement.getAttribute("data-theme")).toBe("oled");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // Switch to light
    store.setTheme("light");
    expect(useThemeStore.getState().theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);

    // Switch to dim
    store.setTheme("dim");
    expect(useThemeStore.getState().theme).toBe("dim");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dim");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("renders pure window TitleBar without application action buttons", () => {
    const html = renderToString(React.createElement(TitleBar));

    expect(html).toContain("ACP Studio");
    expect(html).toContain("深色");
    // Ensure application action buttons are NOT in the window title bar
    expect(html).not.toContain("变更");
    expect(html).not.toContain("终端");
    expect(html).not.toContain("新会话");
  });

  it("renders StudioHeader below with full workspace action buttons preserved", () => {
    const html = renderToString(
      React.createElement(StudioHeader, {
        agents: [
          {
            id: "codex",
            name: "Codex",
            title: "Codex (OpenAI)",
            status: { connected: true, pid: 12345 },
          },
        ],
        activeAgentId: "codex",
        onSelectAgent: () => {},
        onConnect: () => {},
        connecting: false,
        onOpenAuth: () => {},
        onLogout: () => {},
        authOk: true,
        sessionId: "sess-1",
        sessionTitle: "测试会话",
        currentWorkspace: "D:/project/js/Electron/antigravity-acp",
        recentWorkspaces: [],
        onSelectWorkspace: () => {},
        terminalOpen: false,
        onToggleTerminal: () => {},
        hasChangesCwd: true,
        supportsFork: true,
        supportsProviders: false,
        busy: false,
        isStreaming: false,
        onNewSession: () => {},
        onForkSession: () => {},
        onOpenProviders: () => {},
        onOpenChanges: () => {},
        onCloseSession: () => {},
        onDeleteSession: () => {},
        onClearMessages: () => {},
      })
    );

    expect(html).toContain("Codex (OpenAI)");
    expect(html).toContain("antigravity-acp");
    expect(html).toContain("测试会话");
    expect(html).toContain("变更");
    expect(html).toContain("终端");
    expect(html).toContain("新会话");
  });
});
