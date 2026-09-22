import type { Message } from "@/components/ChatArea";

/**
 * Chat threads: persisted per-agent conversation records (Inkdown-style
 * layer 1: instant local render, zero network).
 *
 * A thread binds one UI conversation to one agent (+ its ACP sessionId).
 * Session ids NEVER cross agents: every lookup filters by agentId, and the
 * store only ever binds ids obtained while that agent is active.
 */

export interface ChatThread {
  id: string;
  agentId: string;
  sessionId: string | null;
  /** cwd the session was created/opened with (needed for session/resume). */
  cwd?: string | null;
  title?: string | null;
  messages: Message[];
  updatedAt: number;
  /** True when the remembered sessionId failed to resume (visible degrade). */
  stale?: boolean;
}

export const THREADS_KEY = "acp_threads_v1";
export const MAX_THREADS = 40;
export const MAX_MSGS_PER_THREAD = 200;
export const MAX_CHARS_PER_MESSAGE = 20000;

export function newThreadId(): string {
  return `th-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function trunc(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.length > MAX_CHARS_PER_MESSAGE
    ? text.slice(0, MAX_CHARS_PER_MESSAGE) + "\n…[truncated for local cache]"
    : text;
}

/** Freeze a live message for storage: drop streaming flags, cap sizes. */
export function freezeMessage(m: Message): Message {
  return {
    ...m,
    content: trunc(m.content),
    thought: typeof m.thought === "string" ? trunc(m.thought) : m.thought,
    isStreaming: false,
    toolCalls: Array.isArray(m.toolCalls)
      ? m.toolCalls.map((t) => ({ ...t, status: t.status === "pending" || t.status === "running" ? "cancelled" as const : t.status }))
      : m.toolCalls,
  };
}

function hasUserMessage(t: ChatThread): boolean {
  return t.messages.some((m) => m.role === "user" && m.content.trim().length > 0);
}

/**
 * Prune for storage: drop blank threads (except preserved ids, e.g. the
 * live draft), freeze messages, cap counts. Pure — safe to unit test.
 */
export function pruneThreads(
  threads: Record<string, ChatThread>,
  preserveIds: string[] = [],
): Record<string, ChatThread> {
  const kept = Object.values(threads).filter(
    (t) => preserveIds.includes(t.id) || hasUserMessage(t),
  );
  kept.sort((a, b) => b.updatedAt - a.updatedAt);
  const out: Record<string, ChatThread> = {};
  for (const t of kept.slice(0, MAX_THREADS)) {
    out[t.id] = {
      ...t,
      messages: t.messages.slice(-MAX_MSGS_PER_THREAD).map(freezeMessage),
    };
  }
  return out;
}

/** Latest thread of an agent (null when the agent has no recorded thread). */
export function threadForAgent(
  threads: Record<string, ChatThread>,
  agentId: string,
): ChatThread | null {
  let best: ChatThread | null = null;
  for (const t of Object.values(threads)) {
    if (t.agentId !== agentId) continue;
    if (!best || t.updatedAt > best.updatedAt) best = t;
  }
  return best;
}

export function loadThreads(): Record<string, ChatThread> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(THREADS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, ChatThread> = {};
    for (const [id, t] of Object.entries(parsed as Record<string, any>)) {
      if (!t || typeof t !== "object" || typeof (t as any).agentId !== "string") continue;
      const th = t as ChatThread;
      if (!Array.isArray(th.messages)) continue;
      out[id] = { ...th, id, sessionId: th.sessionId ?? null, updatedAt: th.updatedAt ?? 0 };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveThreads(threads: Record<string, ChatThread>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
  } catch {
    // ignore storage errors (private mode / quota)
  }
}
