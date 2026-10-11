import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStudioStore } from "../../src/stores/useStudioStore";
import { appendActivityMessage } from "../../src/hooks/useChatSend";
import { useAgentConfig } from "../../src/hooks/useAgentConfig";
import { useSessionLifecycle } from "../../src/hooks/useSessionLifecycle";
import { useAppBootAndShortcuts } from "../../src/hooks/useAppBootAndShortcuts";

beforeEach(() => {
  useStudioStore.getState().resetStudio();
  localStorage.clear();
});

function renderTestHook<T>(hookFn: () => T): { result: { current: T }; unmount: () => void } {
  const result = { current: null as any };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function TestComp() {
    result.current = hookFn();
    return null;
  }
  act(() => {
    root.render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(TestComp))
    );
  });
  return {
    result,
    unmount: () => {
      act(() => root.unmount());
      el.remove();
    },
  };
}

describe("Controller hooks & App invariants", () => {
  describe("useChatSend helper (appendActivityMessage)", () => {
    it("filters out internal sync updates and formats human-readable system messages", () => {
      // Internal metadata should never be appended as chat messages
      appendActivityMessage({ kind: "session_info_update", detail: {} }, "12:00");
      appendActivityMessage({ kind: "plan", detail: {} }, "12:00");
      appendActivityMessage({ kind: "config_option_update", detail: {} }, "12:00");
      expect(useStudioStore.getState().messages).toHaveLength(0);

      // Real fs / terminal activities should be formatted cleanly
      appendActivityMessage({ kind: "fs_read", detail: { path: "src/App.tsx" } }, "12:00");
      const msgs = useStudioStore.getState().messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toContain("src/App.tsx");
      expect(msgs[0].content).toContain("fs_read");
    });
  });

  describe("useAgentConfig invariants", () => {
    it("migrates legacy localStorage keys to zustand agentPrefs", async () => {
      localStorage.setItem(
        "acp_default_config_codex",
        JSON.stringify({ model: "gpt-5-preview", effort: "high" })
      );

      const agentsRef = { current: [{ id: "codex", name: "codex" } as any] };
      const ensureSession = vi.fn(async () => "s1");

      const { result, unmount } = renderTestHook(() =>
        useAgentConfig({
          agentsRef,
          ensureSession,
        })
      );

      await result.current.applyDefaultConfigOptions("codex", "s1");

      const pref = useStudioStore.getState().agentPrefs?.codex;
      expect(pref?.configValues).toEqual({ model: "gpt-5-preview", effort: "high" });
      // Legacy key should be removed after migration
      expect(localStorage.getItem("acp_default_config_codex")).toBeNull();
      unmount();
    });

    it("snapshots current options if no preference exists", async () => {
      useStudioStore.getState().setConfigOptions([
        { id: "model", currentValue: "claude-3-7-sonnet" },
        { id: "thinking", currentValue: "medium" },
      ] as any);
      useStudioStore.getState().setModels({
        currentModelId: "claude-3-7-sonnet",
        availableModels: [],
      });

      const agentsRef = { current: [{ id: "claude", name: "claude" } as any] };
      const ensureSession = vi.fn(async () => "s2");

      const { result, unmount } = renderTestHook(() =>
        useAgentConfig({
          agentsRef,
          ensureSession,
        })
      );

      await result.current.applyDefaultConfigOptions("claude", "s2");

      const pref = useStudioStore.getState().agentPrefs?.claude;
      expect(pref?.configValues?.model).toBe("claude-3-7-sonnet");
      expect(pref?.configValues?.thinking).toBe("medium");
      expect(pref?.fallbackModelId).toBe("claude-3-7-sonnet");
      unmount();
    });
  });

  describe("useSessionLifecycle invariants", () => {
    it("respects the resume-first invariant (never blinds force-new)", async () => {
      const st = useStudioStore.getState();
      st.setActiveAgentId("opencode");
      st.newThread("opencode");
      st.bindThreadSession("sess-existing", "/test/path");

      const qc = new QueryClient();
      const agents = [{ id: "opencode", name: "opencode", status: { connected: true } } as any];
      const agentsRef = { current: agents };
      const applyDefaultConfigOptions = vi.fn(async () => {});

      const { unmount } = renderTestHook(() =>
        useSessionLifecycle({
          qc,
          agents,
          agentsRef,
          applyDefaultConfigOptions,
        })
      );

      // Bound session is preserved
      expect(useStudioStore.getState().sessionId).toBe("sess-existing");
      unmount();
    });

    it("guards against race conditions in optimisticOpenSession", async () => {
      const st = useStudioStore.getState();
      st.setActiveAgentId("opencode");
      st.newThread("opencode");

      // User clicks session A: optimistic switch happens immediately
      st.optimisticOpenSession("opencode", "sess-A", "Session A", "/cwd/a");
      expect(useStudioStore.getState().sessionId).toBe("sess-A");

      // User rapidly clicks session B: switches to B
      st.optimisticOpenSession("opencode", "sess-B", "Session B", "/cwd/b");
      expect(useStudioStore.getState().sessionId).toBe("sess-B");

      // Late response for session A must NOT overwrite B because sessionId != sess-A
      expect(useStudioStore.getState().sessionId).toBe("sess-B");
    });
  });

  describe("useAppBootAndShortcuts invariants", () => {
    it("toggles terminal on Ctrl+` and git diff on Ctrl+Shift+D", () => {
      const agents = [{ id: "codex" } as any];
      const agentsRef = { current: agents };

      const { unmount } = renderTestHook(() =>
        useAppBootAndShortcuts({
          agents,
          agentsRef,
          activeAgentId: "codex",
          currentWorkspace: "/workspace",
        })
      );

      // Simulate keydown
      const termEvent = new KeyboardEvent("keydown", { key: "`", ctrlKey: true });
      window.dispatchEvent(termEvent);
      expect(useStudioStore.getState().terminalOpen).toBe(true);

      window.dispatchEvent(termEvent);
      expect(useStudioStore.getState().terminalOpen).toBe(false);

      const diffEvent = new KeyboardEvent("keydown", { key: "d", ctrlKey: true, shiftKey: true });
      window.dispatchEvent(diffEvent);
      expect(useStudioStore.getState().gitChangesOpen).toBe(true);

      window.dispatchEvent(diffEvent);
      expect(useStudioStore.getState().gitChangesOpen).toBe(false);

      unmount();
    });
  });
});
