import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { AgyAcpBridge } from "../../server/bridge/agyBridge";
import { consumeChatSseStream } from "../../src/lib/sse-client";

describe("Mock E2E Black-box System Integration (Tool, Thought, Cancel, Fuzz)", () => {
  let originalAgyBin: string | undefined;
  let bridge: AgyAcpBridge;
  let testSessionId: string;

  beforeAll(async () => {
    originalAgyBin = process.env.AGY_BIN;
    const mockCliPath = path.resolve(
      __dirname,
      "../../scratch/repos/yitom486-agy-acp-map/tests/fixtures/mock-agy-cli.cjs"
    );
    process.env.AGY_BIN = mockCliPath;

    bridge = new AgyAcpBridge(process.cwd());
    await bridge.init();
    const session = await bridge.createSession();
    testSessionId = session.sessionId;
  });

  afterAll(async () => {
    if (bridge && testSessionId) {
      await bridge.cancel(testSessionId);
    }
    process.env.AGY_BIN = originalAgyBin;
  });

  /**
   * Helper that mirrors server/index.ts /api/chat SSE streaming behavior
   */
  function createChatStreamResponse(sessionId: string, promptText: string): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: any) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {}
        };

        send({ type: "start", sessionId });

        try {
          const outcome = await bridge.prompt(
            sessionId,
            [{ type: "text", text: promptText }],
            (update: any) => {
              send({
                type: "update",
                sessionId,
                update,
              });
            }
          );

          send({
            type: "done",
            sessionId,
            stopReason: outcome.stopReason,
          });
        } catch (err: any) {
          send({
            type: "error",
            sessionId,
            message: err.message,
          });
        } finally {
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
      },
    });
  }

  it("Tool Call E2E: dispatches real-time tool events to client consumer", async () => {
    const res = createChatStreamResponse(testSessionId, "Inspect repo files [test:tool]");
    const capturedTools: any[] = [];
    let finalText = "";

    const outcome = await consumeChatSseStream(res.body!, {
      onTextChunk: (chunk) => {
        finalText += chunk;
      },
      onToolCall: (tool) => {
        capturedTools.push(tool);
      },
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(outcome.stopReason).toBe("end_turn");

    // Tool call was recorded with ID and title
    expect(capturedTools.length).toBeGreaterThanOrEqual(1);
    const tool = capturedTools[0];
    expect(tool.id).toBe("agy-tool-1");
    expect(tool.title).toBe("read_file");

    // Final response was delivered
    expect(finalText).toContain("File read complete with success.");
  });

  it("Reasoning / Thought E2E: isolates thought chunks from message chunks", async () => {
    const res = createChatStreamResponse(testSessionId, "Perform deep reasoning [test:thought]");
    let capturedThoughts = "";
    let capturedMessage = "";

    const outcome = await consumeChatSseStream(res.body!, {
      onThoughtChunk: (chunk) => {
        capturedThoughts += chunk;
      },
      onTextChunk: (chunk) => {
        capturedMessage += chunk;
      },
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(outcome.stopReason).toBe("end_turn");

    // Thoughts captured in dedicated stream
    expect(capturedThoughts).toContain("Analyzing the architecture");
    expect(capturedThoughts).toContain("Formulating optimal recommendation");

    // Message captured in separate message stream
    expect(capturedMessage).toContain("Here is the definitive architectural response.");
    // Message does NOT contain raw thought text
    expect(capturedMessage).not.toContain("Analyzing the architecture");
  });

  it("Fuzz / Junk Lines E2E: seamlessly recovers from non-JSON output and logs", async () => {
    const res = createChatStreamResponse(testSessionId, "Trigger dirty logs [test:bad_lines]");
    let capturedText = "";

    const outcome = await consumeChatSseStream(res.body!, {
      onTextChunk: (chunk) => {
        capturedText += chunk;
      },
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(outcome.stopReason).toBe("end_turn");
    expect(capturedText).toBe("Recovered cleanly from bad lines.");
  });

  it("Cancellation E2E: interrupts in-flight prompt and frees session for next prompt", async () => {
    const encoder = new TextEncoder();
    let streamActive = true;

    // Start a delayed prompt
    const promptPromise = bridge.prompt(
      testSessionId,
      [{ type: "text", text: "Long computation [test:cancel_delay]" }],
      () => {}
    );

    // Give process a moment to start and enter delay
    await new Promise((r) => setTimeout(r, 150));

    // Cancel prompt via bridge (same as user clicking Stop button)
    await bridge.cancel(testSessionId);

    const outcome = await promptPromise;
    expect(outcome.stopReason).toBe("cancelled");

    // Immediately trigger another prompt on the SAME session to prove not stuck busy
    const resNext = createChatStreamResponse(testSessionId, "Next prompt after cancel");
    let nextText = "";
    const nextOutcome = await consumeChatSseStream(resNext.body!, {
      onTextChunk: (chunk) => {
        nextText += chunk;
      },
    });

    expect(nextOutcome.completedCleanly).toBe(true);
    expect(nextOutcome.stopReason).toBe("end_turn");
    expect(nextText).toContain("Mock response for [Next prompt after cancel]");
  });
});
