import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

/**
 * Deterministic Mock ACP stdio agent for black-box pipeline tests.
 * Speaks official ACP protocol over stdin/stdout via @agentclientprotocol/sdk.
 * 100% offline, zero cloud tokens, tests complete lifecycle:
 * - Handshake (initialize)
 * - Session creation (session/new)
 * - Event streaming (text, thoughts, tool calls, images, plans, usage)
 * - Interactive client requests (requestPermission, elicitation)
 * - Session cancellation (session/cancel)
 */

let sessSeq = 0;
const cancelledSessions = new Set<string>();

const app = acp
  .agent({ name: "mock-acp-agent", version: "1.0.0" })
  .onRequest(acp.methods.agent.initialize, async (ctx) => {
    return {
      protocolVersion: 1,
      agentCapabilities: {
        promptCapabilities: { image: true, audio: false },
        sessionCapabilities: { list: {}, close: {}, fork: {}, additionalDirectories: {} },
        providers: true,
      },
      agentInfo: {
        name: "mock-acp-agent",
        title: "Mock ACP Blackbox Agent",
        version: "1.0.0",
      },
      authMethods: [],
    } as unknown as acp.InitializeResponse;
  })
  .onRequest(acp.methods.agent.session.new, async (ctx) => {
    const sessionId = `mock-session-${++sessSeq}`;
    return {
      sessionId,
      models: {
        currentModelId: "mock-default",
        availableModels: [
          { id: "mock-default", name: "Mock Default Model", description: "Offline simulation model" },
          { id: "mock-fast", name: "Mock Fast Model", description: "Fast offline model" },
        ],
      },
      modes: {
        currentModeId: "agent",
        availableModes: [{ id: "agent", name: "Agent Mode" }],
      },
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "mock-default",
          options: [
            { value: "mock-default", name: "Mock Default Model" },
            { value: "mock-fast", name: "Mock Fast Model" },
          ],
        },
        {
          id: "thought_mode",
          name: "Thought Mode",
          type: "boolean",
          category: "thought",
          currentValue: true,
        },
      ],
    };
  })
  .onRequest(acp.methods.agent.session.list, async () => {
    return {
      sessions: [
        { sessionId: `mock-session-active`, createdAt: new Date().toISOString() },
      ],
    };
  })
  .onRequest(acp.methods.agent.session.close, async () => {
    return {};
  })
  .onRequest(acp.methods.agent.session.delete, async () => {
    return {};
  })
  .onRequest(acp.methods.agent.session.prompt, async (ctx: any) => {
    const { sessionId, prompt } = ctx.params as { sessionId: string; prompt: any[] };
    const promptText = (prompt || [])
      .map((b: any) => (b.type === "text" ? b.text : ""))
      .join(" ");

    const imageBlocks = (prompt || []).filter((b: any) => b.type === "image");

    cancelledSessions.delete(sessionId);

    // Scenario: Interactive Permission Request
    if (promptText.includes("trigger_permission")) {
      try {
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Encountered sensitive operation, requesting permission..." },
          },
        });

        const outcome = await (ctx.client as any).request(
          acp.methods.client.session.requestPermission,
          {
            sessionId,
            toolCall: {
              toolCallId: "perm-tool-1",
              title: "Execute privileged command",
              kind: "execute",
            },
            options: [
              { optionId: "allow", name: "Allow execution", kind: "allow_once" },
              { optionId: "deny", name: "Deny execution", kind: "reject_once" },
            ],
          }
        );

        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `Permission resolved with: ${JSON.stringify(outcome)}` },
          },
        });

        return { stopReason: "end_turn" };
      } catch (err) {
        console.error("[mock-agent permission error]", err);
        throw err;
      }
    }

    // Scenario: Interactive Elicitation Request
    if (promptText.includes("trigger_elicitation")) {
      try {
        const elRes = await (ctx.client as any).request(
          acp.methods.client.elicitation.create,
          {
            mode: "form",
            sessionId,
            message: "Please enter your API target environment",
            requestedSchema: {
              type: "object",
              properties: {
                targetEnv: { type: "string", description: "Target environment name" },
              },
              required: ["targetEnv"],
            },
          }
        );

        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `Elicitation resolved: ${JSON.stringify(elRes)}` },
          },
        });

        return { stopReason: "end_turn" };
      } catch (err) {
        console.error("[mock-agent elicitation error]", err);
        throw err;
      }
    }

    // Scenario: Cancellation
    if (promptText.includes("trigger_cancel")) {
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Starting long-running operation, awaiting cancellation..." },
        },
      });

      // Wait until cancelled
      for (let i = 0; i < 50; i++) {
        if (cancelledSessions.has(sessionId)) {
          return { stopReason: "cancelled" };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return { stopReason: "end_turn" };
    }

    // Scenario: Standard Full Pipeline Event Stream
    try {
      // 1. Thought chunk
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Thought: Parsing user input and media items..." },
        },
      });

      // 2. Message chunk #1
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello from Mock ACP Agent! " },
        },
      });

      // 3. Image block verification if present
      if (imageBlocks.length > 0) {
        const img = imageBlocks[0];
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `[Verified image mime=${img.mimeType || "unknown"}, dataLength=${(img.data || "").length}] ` },
          },
        });
      }

      // 4. Plan entry
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "plan",
          entries: [
            { content: "Step 1: Inspect environment", priority: "medium", status: "completed" },
            { content: "Step 2: Execute mock tool call", priority: "high", status: "in_progress" },
          ],
        },
      });

      // 5. Tool Call (pending)
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-call-blackbox-1",
          title: "mock_inspect_workspace",
          kind: "read",
          status: "pending",
        },
      });

      await new Promise((r) => setTimeout(r, 20));

      // 6. Tool Call Update (completed) with valid ToolCallContent array
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-call-blackbox-1",
          status: "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: "All mock workspace checks passed" },
            },
          ],
        },
      });

      // 7. Message chunk #2 (final response text)
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "All stream segments delivered successfully." },
        },
      });

      // 8. Usage update
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "usage_update",
          used: 256,
          size: 8192,
        },
      });

      await new Promise((r) => setTimeout(r, 30));
      return { stopReason: "end_turn" };
    } catch (err) {
      console.error("[mock-agent pipeline error]", err);
      throw err;
    }
  })
  .onNotification(acp.methods.agent.session.cancel, (ctx: any) => {
    const { sessionId } = ctx.params as { sessionId: string };
    cancelledSessions.add(sessionId);
  });

process.stdin.resume();

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
);

app.connect(stream);

process.stdin.on("end", () => {
  process.exit(0);
});
