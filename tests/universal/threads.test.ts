import { describe, expect, test } from "vitest";
import {
  freezeMessage,
  pruneThreads,
  threadForAgent,
  type ChatThread,
} from "../../src/lib/threads";

function msg(role: "user" | "assistant", content: string, extra: object = {}) {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
    ...extra,
  } as any;
}

function thread(partial: Partial<ChatThread> & { id: string; agentId: string }): ChatThread {
  return {
    sessionId: null,
    messages: [],
    updatedAt: Date.now(),
    ...partial,
  };
}

describe("threads (per-agent persisted records)", () => {
  test("threadForAgent isolates agents and picks the latest", () => {
    const aOld = thread({ id: "a-old", agentId: "codex", updatedAt: 10 });
    const aNew = thread({ id: "a-new", agentId: "codex", updatedAt: 20 });
    const b = thread({ id: "b", agentId: "antigravity-stdio", updatedAt: 99 });
    const all = { "a-old": aOld, "a-new": aNew, b };
    expect(threadForAgent(all, "codex")?.id).toBe("a-new");
    // Session ids must never leak across agents: lookup is strictly filtered.
    expect(threadForAgent(all, "antigravity-stdio")?.id).toBe("b");
    expect(threadForAgent(all, "unknown-agent")).toBeNull();
  });

  test("pruneThreads drops blank threads but preserves the live draft", () => {
    const blank = thread({ id: "blank", agentId: "codex", messages: [] });
    const live = thread({ id: "live", agentId: "codex", messages: [] });
    const full = thread({
      id: "full",
      agentId: "codex",
      messages: [msg("user", "hi"), msg("assistant", "hello")],
    });
    const out = pruneThreads({ blank, live, full }, ["live"]);
    expect(out.blank).toBeUndefined();
    expect(out.live).toBeDefined();
    expect(out.full.messages).toHaveLength(2);
  });

  test("freezeMessage strips streaming flags and truncates", () => {
    const m = msg("assistant", "x".repeat(25000), {
      isStreaming: true,
      toolCalls: [{ id: "t", title: "t", status: "running" }],
    });
    const f = freezeMessage(m);
    expect(f.isStreaming).toBe(false);
    expect(f.content.length).toBeLessThanOrEqual(20000 + 100);
    expect(f.toolCalls?.[0].status).toBe("cancelled");
  });

  test("pruneThreads caps thread and message counts", () => {
    const many: Record<string, ChatThread> = {};
    for (let i = 0; i < 50; i++) {
      many[`t${i}`] = thread({
        id: `t${i}`,
        agentId: "codex",
        updatedAt: i,
        messages: [msg("user", `q${i}`)],
      });
    }
    const big = thread({
      id: "big",
      agentId: "codex",
      updatedAt: 1000,
      messages: Array.from({ length: 300 }, (_, i) => msg("user", `m${i}`)),
    });
    const out = pruneThreads({ ...many, big });
    expect(Object.keys(out).length).toBeLessThanOrEqual(40);
    expect(out.big.messages).toHaveLength(200);
  });
});
