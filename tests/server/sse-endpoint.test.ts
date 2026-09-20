import { describe, it, expect } from "vitest";

/**
 * Creates a server SSE Response matching server/index.ts /api/chat stream behavior
 */
function createServerChatResponse(
  mockBridgePrompt: (
    sessionId: string,
    prompt: any[],
    onUpdate: (update: any) => void
  ) => Promise<{ stopReason: string }>
): Response {
  const sessionId = "test-session-server";
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller closed
        }
      };

      send({ type: "start", sessionId });

      try {
        const outcome = await mockBridgePrompt(sessionId, [{ type: "text", text: "hi" }], (update) => {
          send({
            type: "update",
            sessionId,
            update,
          });
        });

        send({
          type: "done",
          sessionId,
          stopReason: outcome.stopReason,
        });
      } catch (err: any) {
        send({
          type: "error",
          sessionId,
          message: err.message || "Antigravity ACP execution error",
        });
      } finally {
        // Buffer flush grace period
        await new Promise((r) => setTimeout(r, 50));
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

describe("Server SSE Stream Endpoint Handler", () => {
  it("sets canonical SSE headers for zero-buffering push streams", () => {
    const res = createServerChatResponse(async () => ({ stopReason: "end_turn" }));
    expect(res.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    expect(res.headers.get("Cache-Control")).toContain("no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
  });

  it("streams start, updates, and done event cleanly to downstream client", async () => {
    const res = createServerChatResponse(async (_sid, _prompt, onUpdate) => {
      onUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Server response text" },
      });
      return { stopReason: "end_turn" };
    });

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let combined = "";

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      combined += decoder.decode(value);
    }

    expect(combined).toContain('data: {"type":"start","sessionId":"test-session-server"}');
    expect(combined).toContain("Server response text");
    expect(combined).toContain('data: {"type":"done","sessionId":"test-session-server","stopReason":"end_turn"}');
  });

  it("gracefully transmits error event if bridge prompt rejects", async () => {
    const res = createServerChatResponse(async () => {
      throw new Error("Simulated backend failure");
    });

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let combined = "";

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      combined += decoder.decode(value);
    }

    expect(combined).toContain('data: {"type":"error"');
    expect(combined).toContain("Simulated backend failure");
  });
});
