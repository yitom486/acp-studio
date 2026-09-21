import { describe, it, expect, vi, afterEach } from "vitest";
import { consumeUniversalChat } from "../../src/lib/universal-api";

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

afterEach(() => vi.restoreAllMocks());

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
      { type: "done", sessionId: "sess-1", stopReason: "end_turn" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));

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
    expect(seen).toContain("done:end_turn");
  });
});
