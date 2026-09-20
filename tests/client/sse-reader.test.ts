import { describe, it, expect, vi } from "vitest";
import { consumeChatSseStream } from "@/lib/sse-client";

function createStreamFromChunks(chunks: string[], throwAfter?: Error): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        if (throwAfter) {
          controller.error(throwAfter);
        } else {
          controller.close();
        }
      }
    },
  });
}

describe("SSE Client Reader (consumeChatSseStream)", () => {
  it("processes a standard complete stream cleanly without spurious error", async () => {
    const stream = createStreamFromChunks([
      'data: {"type":"start","sessionId":"sess-123"}\n\n',
      'data: {"type":"update","sessionId":"sess-123","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello "}}}\n\n',
      'data: {"type":"update","sessionId":"sess-123","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"World!"}}}\n\n',
      'data: {"type":"done","sessionId":"sess-123","stopReason":"end_turn"}\n\n',
    ]);

    let text = "";
    let sessionId = "";
    let doneReason = "";
    const onError = vi.fn();

    const outcome = await consumeChatSseStream(stream, {
      onSessionId: (sid) => {
        sessionId = sid;
      },
      onTextChunk: (chunk) => {
        text += chunk;
      },
      onDone: (reason) => {
        doneReason = reason || "";
      },
      onError,
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(outcome.stopReason).toBe("end_turn");
    expect(outcome.sessionId).toBe("sess-123");
    expect(sessionId).toBe("sess-123");
    expect(text).toBe("Hello World!");
    expect(doneReason).toBe("end_turn");
    expect(onError).not.toHaveBeenCalled();
  });

  it("handles agent_thought_chunk for reasoning models", async () => {
    const stream = createStreamFromChunks([
      'data: {"type":"start","sessionId":"sess-think"}\n\n',
      'data: {"type":"update","sessionId":"sess-think","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"[Thinking: analyzing...]\\n"}}}\n\n',
      'data: {"type":"update","sessionId":"sess-think","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Here is the result."}}}\n\n',
      'data: {"type":"done","sessionId":"sess-think","stopReason":"end_turn"}\n\n',
    ]);

    let accumulated = "";
    const outcome = await consumeChatSseStream(stream, {
      onTextChunk: (c) => {
        accumulated += c;
      },
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(accumulated).toContain("[Thinking: analyzing...]");
    expect(accumulated).toContain("Here is the result.");
  });

  it("handles tool_call updates correctly", async () => {
    const stream = createStreamFromChunks([
      'data: {"type":"start","sessionId":"sess-tool"}\n\n',
      'data: {"type":"update","sessionId":"sess-tool","update":{"sessionUpdate":"tool_call","toolCallId":"tool-1","title":"read_file"}}\n\n',
      'data: {"type":"update","sessionId":"sess-tool","update":{"sessionUpdate":"tool_call_update","toolCallId":"tool-1","status":"completed"}}\n\n',
      'data: {"type":"done","sessionId":"sess-tool","stopReason":"end_turn"}\n\n',
    ]);

    const toolCalls: any[] = [];
    const outcome = await consumeChatSseStream(stream, {
      onToolCall: (call) => toolCalls.push(call),
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(toolCalls.length).toBe(2);
    expect(toolCalls[0].title).toBe("read_file");
    expect(toolCalls[1].status).toBe("completed");
  });

  it("PROTECTION TEST: does NOT throw error if connection is abruptly reset AFTER done", async () => {
    // Simulates the exact bug: 'done' arrives, then Vite/Node throws ECONNRESET / network error
    const socketResetError = new TypeError("network error");
    const stream = createStreamFromChunks(
      [
        'data: {"type":"start","sessionId":"sess-reset"}\n\n',
        'data: {"type":"update","sessionId":"sess-reset","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Everything went fine."}}}\n\n',
        'data: {"type":"done","sessionId":"sess-reset","stopReason":"end_turn"}\n\n',
      ],
      socketResetError
    );

    let text = "";
    const onError = vi.fn();
    const onDone = vi.fn();

    const outcome = await consumeChatSseStream(stream, {
      onTextChunk: (chunk) => {
        text += chunk;
      },
      onDone,
      onError,
    });

    // isDone guard MUST prevent calling onError and MUST report completedCleanly = true
    expect(outcome.completedCleanly).toBe(true);
    expect(outcome.stopReason).toBe("end_turn");
    expect(text).toBe("Everything went fine.");
    expect(onDone).toHaveBeenCalledWith("end_turn");
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports error if connection fails BEFORE done arrives", async () => {
    const networkFail = new Error("Connection dropped prematurely");
    const stream = createStreamFromChunks(
      [
        'data: {"type":"start","sessionId":"sess-fail"}\n\n',
        'data: {"type":"update","sessionId":"sess-fail","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Partial..."}}}\n\n',
      ],
      networkFail
    );

    const onError = vi.fn();
    const outcome = await consumeChatSseStream(stream, {
      onError,
    });

    expect(outcome.completedCleanly).toBe(false);
    expect(onError).toHaveBeenCalledWith(networkFail);
  });

  it("handles server error payload and triggers onAuthRequired when applicable", async () => {
    const stream = createStreamFromChunks([
      'data: {"type":"start","sessionId":"sess-auth"}\n\n',
      'data: {"type":"error","sessionId":"sess-auth","message":"Authentication required: please log in"}\n\n',
    ]);

    const onAuthRequired = vi.fn();
    const onError = vi.fn();

    const outcome = await consumeChatSseStream(stream, {
      onAuthRequired,
      onError,
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(onAuthRequired).toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it("reassembles fragmented chunks and ignores keepalive comments", async () => {
    // Fragmented transmission across multiple network frames
    const stream = createStreamFromChunks([
      ': keep',
      'alive\n\n',
      'data: {"type":"st',
      'art","sessionId":"s1"}\n\n',
      ': keepalive\n\n',
      'data: {"type":"update","sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Frag',
      'mented chunk"}}}\n\n',
      'data: {"type":"done","sessionId":"s1"}\n\n',
    ]);

    let text = "";
    const outcome = await consumeChatSseStream(stream, {
      onTextChunk: (chunk) => {
        text += chunk;
      },
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(text).toBe("Fragmented chunk");
  });
});
