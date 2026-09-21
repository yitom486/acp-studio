import { describe, it, expect, beforeEach } from "vitest";
import { useStudioStore } from "../../src/stores/useStudioStore";

beforeEach(() => {
  useStudioStore.getState().resetStudio();
});

describe("useStudioStore", () => {
  it("holds connection and session view state", () => {
    const s = useStudioStore.getState();
    s.setActiveAgentId("claude");
    s.setSessionId("sess-1");
    s.setAuthOk("claude", true);
    const cur = useStudioStore.getState();
    expect(cur.activeAgentId).toBe("claude");
    expect(cur.sessionId).toBe("sess-1");
    expect(cur.authOk).toEqual({ claude: true });
  });

  it("appends and patches messages by id without rebuilding the tree", () => {
    const s = useStudioStore.getState();
    s.appendMessage({ id: "a", role: "assistant", content: "", timestamp: "t" });
    s.appendMessage({ id: "b", role: "user", content: "hi", timestamp: "t" });
    s.patchMessage("a", (m) => ({ ...m, content: m.content + "hello" }));
    s.patchMessage("b", { content: "hi!" });
    const msgs = useStudioStore.getState().messages;
    expect(msgs.map((m) => m.id)).toEqual(["a", "b"]);
    expect(msgs[0].content).toBe("hello");
    expect(msgs[1].content).toBe("hi!");
  });

  it("applies session results and resets thread state", () => {
    const s = useStudioStore.getState();
    s.applySessionResult({
      sessionId: "s1",
      modes: { currentModeId: "agent", availableModes: [] },
      configOptions: [{ id: "model" }],
      availableCommands: [{ name: "/status" }],
    });
    expect(useStudioStore.getState().sessionId).toBe("s1");
    expect(useStudioStore.getState().configOptions).toHaveLength(1);
    s.patchConfigOption({ id: "model", currentValue: "x" });
    expect(useStudioStore.getState().configOptions?.[0]).toMatchObject({ id: "model", currentValue: "x" });
    s.resetThread();
    const cur = useStudioStore.getState();
    expect(cur.messages).toEqual([]);
    expect(cur.sessionId).toBe("s1"); // thread reset keeps the session
    expect(cur.configOptions).toBeNull();
  });

  it("tracks pending approvals", () => {
    const s = useStudioStore.getState();
    s.addPermission({ permissionId: "p1", agentId: "codex", sessionId: "s", toolCall: {}, options: [] });
    expect(useStudioStore.getState().pendingPerms).toHaveLength(1);
    s.removePermission("p1");
    expect(useStudioStore.getState().pendingPerms).toHaveLength(0);
  });
});
