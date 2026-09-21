import { describe, it, expect, vi, afterEach } from "vitest";
import { consumeUniversalChat, buildTranscriptFromReplay, parseModelId, findConfigOption, configCurrentValue } from "../../src/lib/universal-api";

function sseResponse(frames: unknown[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("consumeUniversalChat (v1 full updates)", () => {
  it("parses text/thought/tool/plan/usage/permission/done", async () => {
    const frames = [
      { type: "start", sessionId: "sess-1" },
      { type: "update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello " } } },
      { type: "update", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } } },
      { type: "update", update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read file", kind: "read", status: "pending" } },
      { type: "update", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" } },
      { type: "update", update: { sessionUpdate: "plan", entries: [{ content: "step1", status: "in_progress" }] } },
      { type: "update", update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "/status" }] } },
      { type: "update", update: { sessionUpdate: "current_mode_update", currentModeId: "agent" } },
      { type: "update", update: { sessionUpdate: "usage_update", used: 100, size: 200 } },
      { type: "permission_request", agentId: "codex", sessionId: "sess-1", permissionId: "perm-1", toolCall: {}, options: [] },
      { type: "activity", kind: "fs_read", detail: { path: "/tmp/a.txt" } },
      { type: "update", update: { sessionUpdate: "plan_update", plan: { entries: [{ content: "s", status: "completed" }] } } },
      { type: "update", update: { sessionUpdate: "compaction_update", compactionId: "c1", status: "in_progress" } },
      { type: "done", sessionId: "sess-1", stopReason: "end_turn" },
    ];
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => sseResponse(frames)) as unknown as typeof fetch;

    const seen: string[] = [];
    const out = await consumeUniversalChat(
      { agentId: "codex", prompt: "hi" },
      {
        onSessionId: (s) => seen.push("sid:" + s),
        onTextChunk: (t) => seen.push("text:" + t),
        onThoughtChunk: (t) => seen.push("thought:" + t),
        onToolCall: (c) => seen.push("tool:" + c.id),
        onToolCallUpdate: (c) => seen.push("toolupd:" + c.id + ":" + c.status),
        onPlan: (e) => seen.push("plan:" + e.length),
        onAvailableCommands: (c) => seen.push("cmds:" + c.length),
        onModeUpdate: (m) => seen.push("mode:" + m),
        onUsage: (u) => seen.push(`usage:${u.used}/${u.size}`),
        onPermissionRequest: (p) => seen.push("perm:" + p.permissionId),
        onActivity: (a) => seen.push("activity:" + a.kind),
        onDone: (s) => seen.push("done:" + s),
      }
    );
    expect(out.stopReason).toBe("end_turn");
    expect(seen).toContain("text:hello ");
    expect(seen).toContain("thought:thinking");
    expect(seen).toContain("tool:t1");
    expect(seen).toContain("toolupd:t1:running");
    expect(seen).toContain("plan:1");
    expect(seen).toContain("usage:100/200");
    expect(seen).toContain("perm:perm-1");
    expect(seen).toContain("activity:fs_read");
    expect(seen).toContain("activity:compaction_update");
    expect(seen).toContain("done:end_turn");
  });

  it("rebuilds transcripts from session/load replay", () => {
    const t = buildTranscriptFromReplay([
      { sessionUpdate: "user_message_chunk", messageId: "m1", content: { type: "text", text: "hello" } },
      { sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "hi " } },
      { sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "there" } },
      { sessionUpdate: "agent_thought_chunk", messageId: "m2", content: { type: "text", text: "hmm" } },
      { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", status: "pending" },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" },
      { sessionUpdate: "plan", entries: [{ content: "step", status: "completed" }] },
      { sessionUpdate: "usage_update", used: 10, size: 100 },
      { sessionUpdate: "available_commands_update", availableCommands: [{ name: "/status" }] },
      { sessionUpdate: "current_mode_update", currentModeId: "agent" },
    ]);
    expect(t.messages).toHaveLength(3);
    expect(t.messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(t.messages[1]).toMatchObject({ role: "assistant", content: "hi there", thought: "hmm" });
    expect(t.messages[2].toolCalls?.[0]).toMatchObject({ id: "t1", status: "completed" });
    expect(t.plan).toHaveLength(1);
    expect(t.usage).toMatchObject({ used: 10, size: 100 });
    expect(t.availableCommands).toHaveLength(1);
    expect(t.currentModeId).toBe("agent");
  });

  it("parses catalog model ids and maps config roles", () => {
    expect(parseModelId("gpt-5.6-luna[xhigh]")).toEqual({ model: "gpt-5.6-luna", effort: "xhigh" });
    expect(parseModelId("plain-model")).toEqual({ model: "plain-model" });
    const opts = [
      { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "agent", options: [] },
      { id: "model", name: "Model", category: "model", type: "select", currentValue: "gpt-5.6-luna", options: [] },
      { id: "reasoning_effort", name: "Reasoning", category: "thought_level", type: "select", currentValue: "xhigh", options: [] },
    ];
    expect(findConfigOption(opts, "model")?.id).toBe("model");
    expect(findConfigOption(opts, "thinking")?.id).toBe("reasoning_effort");
    expect(findConfigOption(opts, "permission")?.id).toBe("mode");
    expect(configCurrentValue(opts[0])).toBe("agent");
    expect(configCurrentValue({ id: "x", name: "x", type: "select", currentValue: { value: "v" } })).toBe("v");
  });
});
