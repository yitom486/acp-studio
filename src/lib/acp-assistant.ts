import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Message } from "@/lib/message-types";
import type { PendingPermission } from "@/lib/universal-api";
import { partitionTurnContent } from "@/lib/threads";

/**
 * ACP Message -> assistant-ui ThreadMessageLike.
 *
 * Mapping preserves all ACP-specific state so the custom Thread UI can
 * render it without loss:
 * - thought      -> reasoning part
 * - toolCalls[]  -> tool-call parts (toolName=title, args carries kind/status)
 * - content      -> text part
 * - plan/usage/model/mode/timestamp/isStreaming -> metadata.custom
 */
export interface AcpCustomMetadata {
  plan?: Message["plan"];
  usage?: Message["usage"];
  model?: string;
  mode?: string;
  timestamp?: string;
  isStreaming?: boolean;
  originalRole?: Message["role"];
  startedAt?: number;
  completedAt?: number;
  thoughtTiming?: Message["thoughtTiming"];
}

export function convertAcpMessage(msg: Message): ThreadMessageLike {
  if (msg.role === "user") {
    return {
      id: msg.id,
      role: "user",
      content: [
        { type: "text", text: msg.content || "" },
        ...(msg.images || []).filter((img) => img && typeof img.src === "string" && img.src).map((img) => ({ type: "image" as const, image: img.src })),
      ],
      metadata: {
        custom: {
          timestamp: msg.timestamp,
        } satisfies AcpCustomMetadata,
      },
    };
  }

  if (msg.role === "system") {
    return {
      id: msg.id,
      role: "system",
      content: [{ type: "text", text: msg.content || "" }],
      metadata: {
        custom: {
          timestamp: msg.timestamp,
          originalRole: "system",
        } satisfies AcpCustomMetadata,
      },
    };
  }

  // assistant
  const content: Array<
    | { type: "text"; text: string }
    | { type: "reasoning"; text: string; timing?: { startedAt: number; completedAt?: number } }
    | { type: "image"; image: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        args: Record<string, string>;
        argsText: string;
        result: unknown;
        isError: boolean;
        timing?: { startedAt: number; completedAt?: number };
      }
  > = [];

  if (msg.thought) {
    content.push({
      type: "reasoning",
      text: msg.thought,
      ...(msg.thoughtTiming?.startedAt ? { timing: { ...msg.thoughtTiming, startedAt: msg.thoughtTiming.startedAt } } : {}),
    });
  }

  for (const tc of msg.toolCalls || []) {
    const rawName = tc.name || tc.title || "tool";
    const cleanName = rawName.replace(/^studio[-_]ui[:_./]/i, "");
    const toolName = cleanName || rawName;
    let args: Record<string, any> = {};
    if (tc.rawInput && typeof tc.rawInput === "object") {
      args = tc.rawInput as Record<string, any>;
    } else if (typeof tc.rawInput === "string") {
      try {
        const parsed = JSON.parse(tc.rawInput);
        if (parsed && typeof parsed === "object") args = parsed;
        else args = { rawText: tc.rawInput };
      } catch {
        args = { rawText: tc.rawInput };
      }
    } else {
      args = { kind: tc.kind ?? "", status: tc.status };
    }
    const argsText =
      typeof tc.rawInput === "string"
        ? tc.rawInput
        : tc.rawInput
          ? JSON.stringify(tc.rawInput)
          : tc.kind
            ? `[${tc.kind}] ${tc.title}`
            : tc.title;

    content.push({
      type: "tool-call",
      toolCallId: tc.id,
      toolName,
      args,
      argsText,
      result: tc.rawOutput !== undefined ? tc.rawOutput : tc.status,
      isError: tc.status === "failed" || tc.status === "cancelled",
      ...(tc.startedAt ? { timing: { startedAt: tc.startedAt, ...(tc.completedAt ? { completedAt: tc.completedAt } : {}) } } : {}),
    });
  }

  // Always keep a text part so streaming / empty states render (conclusions directly surfaced at bottom).
  const { conclusion } = partitionTurnContent(
    msg.content,
    (msg as any).progressContent,
    Boolean(msg.toolCalls && msg.toolCalls.length > 0)
  );
  content.push({ type: "text", text: conclusion || msg.content || "" });

  // Agent-sent images (after text; order within a turn is text-then-images).
  for (const img of msg.images || []) {
    if (img && typeof img.src === "string" && img.src) {
      content.push({ type: "image", image: img.src });
    }
  }

  return {
    id: msg.id,
    role: "assistant",
    content,
    status: msg.isStreaming ? { type: "running" } : { type: "complete", reason: "stop" },
    metadata: {
      custom: {
        plan: msg.plan,
        usage: msg.usage,
        model: msg.model,
        mode: msg.mode,
        timestamp: msg.timestamp,
        isStreaming: msg.isStreaming,
        originalRole: "assistant",
        startedAt: msg.startedAt,
        completedAt: msg.completedAt,
        thoughtTiming: msg.thoughtTiming,
      } satisfies AcpCustomMetadata,
    },
  };
}

export function convertAcpMessages(messages: Message[]): ThreadMessageLike[] {
  const filtered: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "system") {
      const prev = filtered[filtered.length - 1];
      if (prev && prev.role === "system" && prev.content?.trim() === msg.content?.trim()) {
        continue; // 连续重复的系统提示直接去重折叠
      }
    }
    filtered.push(msg);
  }
  return filtered.map(convertAcpMessage);
}

/** Extract plain text from an assistant-ui AppendMessage (for onNew/onEdit). */
export function extractAppendText(message: {
  content: ReadonlyArray<{ type: string; text?: string }>;
}): string {
  return message.content
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

export interface InlinePermMatch {
  messageId: string;
  toolCallId: string;
}

/**
 * Match an ACP permission request to a visible tool-call part so it can be
 * approved inline in the tool card. Matches by toolCallId first, falls back
 * to title; requires same session when one is bound.
 */
export function matchPermToToolCalls(
  perm: PendingPermission,
  messages: Message[],
  sessionId: string | null,
): InlinePermMatch | null {
  if (sessionId && perm.sessionId !== sessionId) return null;
  const tool = (perm.toolCall ?? {}) as {
    toolCallId?: string;
    id?: string;
    title?: string;
  };
  const wantId = tool.toolCallId || tool.id || null;
  const wantTitle = tool.title || null;
  if (!wantId && !wantTitle) return null;
  for (const m of messages) {
    if (m.role !== "assistant" || !m.toolCalls) continue;
    for (const tc of m.toolCalls) {
      if ((wantId && tc.id === wantId) || (wantTitle && tc.title === wantTitle)) {
        return { messageId: m.id, toolCallId: tc.id };
      }
    }
  }
  return null;
}
