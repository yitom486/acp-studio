import type { Message } from "@/lib/message-types";

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
  /** MCP servers bound to this thread (carried into auto new/resume). */
  mcpServers?: unknown[];
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

/**
 * Freeze a live message for storage: drop streaming flags, cap sizes.
 * Persist policy (user-visible history = Q&A only): the persisted record
 * keeps the final answer text (+thought), but NEVER tool calls/results or
 * agent images (data URLs would blow up localStorage) — they are live-view
 * only and are stripped here, not at render time.
 */
export function freezeMessage(m: Message): Message {
  return {
    ...m,
    content: trunc(m.content),
    thought: typeof m.thought === "string" ? trunc(m.thought) : m.thought,
    isStreaming: false,
    toolCalls: undefined,
    images: undefined,
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

/**
 * 标准化路径比较（统一反斜杠、去除尾随斜杠、Windows 盘符首字母统一小写）
 */
export function normalizeCwd(cwd?: string | null): string {
  if (!cwd) return "";
  const cleaned = cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-zA-Z]:/.test(cleaned)) {
    return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  }
  return cleaned;
}

export function isSameCwd(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return normalizeCwd(a) === normalizeCwd(b);
}

/** Latest thread of an agent, optionally scoped to a workspace cwd */
export function threadForAgent(
  threads: Record<string, ChatThread>,
  agentId: string,
  cwd?: string | null,
): ChatThread | null {
  let best: ChatThread | null = null;
  const target = cwd ? normalizeCwd(cwd) : null;
  for (const t of Object.values(threads)) {
    if (t.agentId !== agentId) continue;
    if (target) {
      if (!t.cwd || normalizeCwd(t.cwd) !== target) continue;
    }
    if (!best || t.updatedAt > best.updatedAt) best = t;
  }
  return best;
}

/** Get all threads for a specific workspace cwd */
export function threadsForCwd(
  threads: Record<string, ChatThread>,
  cwd: string,
  agentId?: string,
): ChatThread[] {
  const target = normalizeCwd(cwd);
  if (!target) return [];
  const list = Object.values(threads).filter((t) => {
    if (agentId && t.agentId !== agentId) return false;
    return Boolean(t.cwd && normalizeCwd(t.cwd) === target);
  });
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  return list;
}

/** Find a recorded thread by exact sessionId for an agent (optimistic instant switch). */
export function findThreadBySessionId(
  threads: Record<string, ChatThread>,
  agentId: string,
  sessionId: string,
): ChatThread | null {
  if (!sessionId) return null;
  for (const t of Object.values(threads)) {
    if (t.agentId === agentId && t.sessionId === sessionId) return t;
  }
  return null;
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
