/**
 * Resilient Server-Sent Events (SSE) Stream Consumer for Antigravity ACP Studio.
 * Handles chunk decoding, line buffering, event dispatch, and graceful stream termination.
 */

export interface ToolCallItem {
  id: string;
  title: string;
  status: "running" | "completed" | "failed";
}

export interface SseStreamHandlers {
  onSessionId?: (sessionId: string) => void;
  onTextChunk?: (chunk: string) => void;
  onThoughtChunk?: (chunk: string) => void;
  onToolCall?: (call: ToolCallItem) => void;
  onDone?: (stopReason?: string) => void;
  onError?: (err: Error) => void;
  onAuthRequired?: () => void;
}

export interface SseStreamOutcome {
  completedCleanly: boolean;
  stopReason?: string;
  sessionId?: string;
}

export async function consumeChatSseStream(
  stream: ReadableStream<Uint8Array>,
  handlers: SseStreamHandlers = {}
): Promise<SseStreamOutcome> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let isDone = false;
  let activeSessionId: string | undefined;
  let stopReason: string | undefined = "end_turn";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const payload = JSON.parse(trimmed.slice(6));

          if (payload.type === "start" && payload.sessionId) {
            activeSessionId = payload.sessionId;
            handlers.onSessionId?.(payload.sessionId);
          }

          if (payload.type === "update" && payload.update) {
            const u = payload.update;
            // Handle reasoning/thought chunk
            if (
              u.sessionUpdate === "agent_thought_chunk" &&
              u.content?.type === "text" &&
              typeof u.content.text === "string"
            ) {
              if (handlers.onThoughtChunk) {
                handlers.onThoughtChunk(u.content.text);
              } else {
                handlers.onTextChunk?.(u.content.text);
              }
            } else if (
              u.sessionUpdate === "agent_message_chunk" &&
              u.content?.type === "text" &&
              typeof u.content.text === "string"
            ) {
              handlers.onTextChunk?.(u.content.text);
            }

            // Handle tool calls
            if (
              u.sessionUpdate === "tool_call" ||
              u.sessionUpdate === "tool_use" ||
              u.sessionUpdate === "tool_call_update"
            ) {
              const toolTitle =
                u.toolCall?.title ||
                u.title ||
                u.name ||
                (u.kind ? `Tool: ${u.kind}` : "Tool Operation");
              const toolId = u.toolCallId || "tool-" + Date.now();
              const status: "running" | "completed" | "failed" =
                u.status === "failed"
                  ? "failed"
                  : u.status === "in_progress"
                  ? "running"
                  : "completed";
              handlers.onToolCall?.({ id: toolId, title: toolTitle, status });
            }
          }

          if (payload.type === "done") {
            isDone = true;
            stopReason = payload.stopReason || "end_turn";
            handlers.onDone?.(stopReason);
            break;
          }

          if (payload.type === "error") {
            isDone = true;
            if (payload.message?.includes("Authentication required")) {
              handlers.onAuthRequired?.();
            }
            handlers.onError?.(new Error(payload.message || "Antigravity ACP error"));
            break;
          }
        } catch {
          // Ignore unparseable non-JSON SSE lines or comments
        }
      }

      if (isDone) {
        try {
          await reader.cancel();
        } catch {
          // ignore reader cancellation error
        }
        break;
      }
    }
  } catch (err: any) {
    if (!isDone && err.name !== "AbortError") {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
      return { completedCleanly: false, stopReason: "error", sessionId: activeSessionId };
    }
  }

  return {
    completedCleanly: isDone,
    stopReason,
    sessionId: activeSessionId,
  };
}
