import { describe, it, expect, vi } from "vitest";
import { consumeChatSseStream } from "@/lib/sse-client";

describe("Full Chat Pipeline Integration (Server Response -> Client Consumer)", () => {
  it("streams full dialogue and terminates gracefully with zero network error", async () => {
    // 1. Simulate server creating the SSE stream
    const encoder = new TextEncoder();
    const serverStream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"start","sessionId":"pipe-session-1"}\n\n'));
        controller.enqueue(encoder.encode(': keepalive\n\n'));
        controller.enqueue(
          encoder.encode(
            'data: {"type":"update","sessionId":"pipe-session-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"你好！我是 Antigravity。"}}}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"update","sessionId":"pipe-session-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"随时可以告诉我！"}}}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode('data: {"type":"done","sessionId":"pipe-session-1","stopReason":"end_turn"}\n\n')
        );

        // Server buffer flush delay
        await new Promise((r) => setTimeout(r, 20));
        controller.close();
      },
    });

    const mockResponse = new Response(serverStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });

    // 2. Consume with client consumer
    let fullText = "";
    let capturedSid = "";
    const onError = vi.fn();
    const onDone = vi.fn();

    const outcome = await consumeChatSseStream(mockResponse.body!, {
      onSessionId: (sid) => {
        capturedSid = sid;
      },
      onTextChunk: (chunk) => {
        fullText += chunk;
      },
      onDone,
      onError,
    });

    // 3. Verify complete pipeline results
    expect(outcome.completedCleanly).toBe(true);
    expect(outcome.stopReason).toBe("end_turn");
    expect(capturedSid).toBe("pipe-session-1");
    expect(fullText).toBe("你好！我是 Antigravity。随时可以告诉我！");
    expect(onDone).toHaveBeenCalledWith("end_turn");
    // Verify that NO spurious network error was emitted
    expect(onError).not.toHaveBeenCalled();
  });

  it("handles consecutive multi-turn dialogue on the same session without hanging", async () => {
    const encoder = new TextEncoder();

    // Turn 1
    const streamTurn1 = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"start","sessionId":"multi-turn-sess"}\n\n'));
        controller.enqueue(
          encoder.encode(
            'data: {"type":"update","sessionId":"multi-turn-sess","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Turn 1 answer."}}}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode('data: {"type":"done","sessionId":"multi-turn-sess","stopReason":"end_turn"}\n\n')
        );
        await new Promise((r) => setTimeout(r, 10));
        controller.close();
      },
    });

    let turn1Text = "";
    const outcome1 = await consumeChatSseStream(new Response(streamTurn1).body!, {
      onTextChunk: (chunk) => {
        turn1Text += chunk;
      },
    });
    expect(outcome1.completedCleanly).toBe(true);
    expect(turn1Text).toBe("Turn 1 answer.");

    // Turn 2 (consecutive on same session)
    const streamTurn2 = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"start","sessionId":"multi-turn-sess"}\n\n'));
        controller.enqueue(
          encoder.encode(
            'data: {"type":"update","sessionId":"multi-turn-sess","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Turn 2 answer: yes, multimodal is supported."}}}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode('data: {"type":"done","sessionId":"multi-turn-sess","stopReason":"end_turn"}\n\n')
        );
        await new Promise((r) => setTimeout(r, 10));
        controller.close();
      },
    });

    let turn2Text = "";
    const outcome2 = await consumeChatSseStream(new Response(streamTurn2).body!, {
      onTextChunk: (chunk) => {
        turn2Text += chunk;
      },
    });
    expect(outcome2.completedCleanly).toBe(true);
    expect(turn2Text).toBe("Turn 2 answer: yes, multimodal is supported.");
  });
});
