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
 * 将任意路径提纯为符合目标运行环境规范的原生 CWD 路径（零硬编码、通用适配 WSL、SSH、Remote、Local）。
 *
 * 1. 当目标环境是 POSIX 平台（Linux / WSL / SSH 远程 Linux / macOS 等）：
 *    - 若携带 Windows UNC 包装（如 \\wsl.localhost\Ubuntu\home\... 或 //wsl$\Ubuntu/...），剥离 UNC 前缀，还原为纯正的 Linux 原生路径；
 *    - 若宿主机错误在 POSIX 绝对路径前拼接了 Windows 盘符（如 D:\home\... 或 C:\var\...），自动剔除盘符；
 *    - 统一将反斜杠替换为正斜杠；
 *    - 保证输出永远是以 / 开头的纯净 POSIX 路径，绝不包含任何盘符或 UNC 前缀。
 *
 * 2. 当目标环境是 Windows 平台：
 *    - 保留 Windows 风格路径（带盘符或 Windows 路径格式）。
 */
export function toEnvironmentNativeCwd(rawPath?: string | null, isPosix = false): string {
  if (!rawPath) return "";
  let p = rawPath.trim().replace(/\\/g, "/");

  // 若带 Windows WSL UNC 前缀，剥离 UNC 包装，提取真实路径
  const uncMatch = /^\/\/(?:wsl\$|wsl\.localhost)\/[^\/]+(\/.*)?$/i.exec(p);
  if (uncMatch) {
    p = uncMatch[1] || "/";
  }

  if (isPosix) {
    // POSIX 模式（WSL / SSH / Linux）：
    // 若错误拼接了 Windows 盘符（如 D:/home/... 或 C:/opt/...），剥离盘符还原为 POSIX 原生路径
    const drivePosixMatch = /^[a-zA-Z]:(\/.*)$/.exec(p);
    if (drivePosixMatch) {
      p = drivePosixMatch[1];
    }
    // 若没有以 / 开头，补齐 /
    if (!p.startsWith("/")) {
      p = "/" + p;
    }
  }

  // 去除尾随多余斜杠（除非根目录 /）
  if (p.length > 1 && p.endsWith("/")) {
    p = p.replace(/\/+$/, "");
  }

  return p;
}

/**
 * 标准化路径比较（统一反斜杠、去除尾随斜杠、Windows 盘符首字母统一小写、WSL UNC 统一折叠）
 */
export function normalizeCwd(cwd?: string | null): string {
  if (!cwd) return "";
  let cleaned = toEnvironmentNativeCwd(cwd, false);
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
