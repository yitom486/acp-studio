import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { AgyAcpBridge } from "../../server/bridge/agyBridge";
import { consumeChatSseStream } from "../../src/lib/sse-client";

describe("Mock E2E Multi-turn Pipeline (Offline Simulation, Zero Cloud Cost)", () => {
  let originalAgyBin: string | undefined;
  let bridge: AgyAcpBridge;
  let testSessionId: string;

  beforeAll(async () => {
    originalAgyBin = process.env.AGY_BIN;
    // Route to our deterministic offline mock CLI fixture
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

  it("completes Turn 1 via simulated mock CLI through bridge and SSE client", async () => {
    const res = createChatStreamResponse(testSessionId, "What is your architecture?");
    let turn1Text = "";

    const outcome = await consumeChatSseStream(res.body!, {
      onTextChunk: (chunk) => {
        turn1Text += chunk;
      },
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(outcome.stopReason).toBe("end_turn");
    expect(turn1Text).toBe("Mock response for [What is your architecture?] (turn 1)");
  });

  it("completes Turn 2 on the SAME session without hanging (proves setCallbacks fix)", async () => {
    // Consecutive prompt on the exact same session - previous bug hung right here
    const res = createChatStreamResponse(testSessionId, "Can you handle multi-turn?");
    let turn2Text = "";

    const outcome = await consumeChatSseStream(res.body!, {
      onTextChunk: (chunk) => {
        turn2Text += chunk;
      },
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(outcome.stopReason).toBe("end_turn");
    expect(turn2Text).toBe("Mock response for [Can you handle multi-turn?] (turn 2)");
  });

  it("completes Turn 3 on the SAME session seamlessly", async () => {
    const res = createChatStreamResponse(testSessionId, "Third follow-up question");
    let turn3Text = "";

    const outcome = await consumeChatSseStream(res.body!, {
      onTextChunk: (chunk) => {
        turn3Text += chunk;
      },
    });

    expect(outcome.completedCleanly).toBe(true);
    expect(outcome.stopReason).toBe("end_turn");
    expect(turn3Text).toBe("Mock response for [Third follow-up question] (turn 3)");
  });
});
