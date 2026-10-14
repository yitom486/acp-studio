import { useCallback, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useStudioStore } from "@/stores/useStudioStore";
import { invalidateSessions, acpKeys } from "@/lib/acp-queries";
import type { SessionItem } from "@/components/universal/Sidebar";
import {
  connectAgent,
  sessionRpc,
  consumeUniversalChat,
  respondPermission,
  respondElicitation,
  isAuthRequiredError,
  pickUsageExtras,
  type UsageUpdate,
  type ActivityEvent,
  type AgentSummary,
  type PendingPermission,
  type PendingElicitation,
} from "@/lib/universal-api";
import { parseRateLimitsFromStatusText } from "@/lib/quota-parser";

export interface UseChatSendOptions {
  qc: QueryClient;
  agentsRef: React.MutableRefObject<AgentSummary[]>;
  resolveSession: (agentId: string) => Promise<string | null>;
  now?: () => string;
  /**
   * Stream retry policy. Auto-retries TRANSIENT failures only (network/
   * timeout/5xx class) — never aborts (user stop), auth errors, or
   * semantic failures. Manual retry remains the ↻ regenerate button.
   */
  retry?: {
    max?: number;
    delayMs?: (attempt: number) => number;
  };
}

const DEFAULT_RETRY = {
  max: 2,
  delayMs: (attempt: number) => 1000 * 2 ** (attempt - 1),
};

/** True for failures worth an automatic resend (transport-level, likely fleeting). */
export function isTransientSendError(err: unknown): boolean {
  if (!err) return false;
  if ((err as { name?: unknown } | null)?.name === "AbortError") return false;
  if (isAuthRequiredError(err)) return false;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /fetch failed|failed to fetch|networkerror|network request failed|load failed|timeout|timed out|econnreset|econnrefused|epipe|socket hang up|temporarily|try again|rate limit|too many requests|429|50[0234]|service unavailable|bad gateway|gateway timeout|not ready/i.test(
    msg
  );
}

const RETRY_NOTE_RE = /\n\n> 🔁 连接中断，正在重试[^\n]*\n?/g;

/** Strip auto-retry status notes after a successful resend. */
export function stripRetryNotes(content: string): string {
  return content.replace(RETRY_NOTE_RE, "");
}

function sleepAbortable(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    }, ms);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const defaultNow = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Appends a formatted system message for non-chat activity notifications (fs, terminal, compaction), or attaches to active assistant turn. */
export function appendActivityMessage(a: ActivityEvent, timestamp: string, assistantId?: string) {
  if (!a?.kind || a.kind === "session_info_update" || a.kind.endsWith("_update") || a.kind === "plan") {
    return;
  }
  let summary = "";
  try {
    const d: any = a.detail || {};
    summary = d.path || d.command || d.terminalId || d.status || (typeof d === "string" ? d : "");
  } catch {
    summary = "";
  }
  if (!summary) return;

  // 智能体流式生成期间：绝不在助手轮次中编造伪工具调用，也绝不插入孤立的 system 消息打断气泡流。
  // 智能体本身会经由 ACP 协议（onToolCall / onToolCallUpdate）自主下发真实的工具调用。
  // 伪造工具或插入额外消息会破坏真实的后端 AI 运行时状态。
  if (assistantId && (a.kind.startsWith("fs_") || a.kind.startsWith("terminal_"))) {
    return;
  }

  const icon =
    a.kind === "fs_read"
      ? "📖"
      : a.kind === "fs_write"
        ? "📝"
        : a.kind.startsWith("terminal")
          ? "▶️"
          : a.kind.startsWith("compaction")
            ? "🗜️"
            : a.kind.startsWith("plan")
              ? "📋"
              : "🔧";
  const line = `${icon} [${a.kind}] ${summary}`.trim();
  useStudioStore.getState().appendMessage({
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: "system",
    content: line,
    timestamp,
  });
}

/**
 * Chat turn orchestration, streaming SSE consumption, and cancellation hook.
 *
 * Implements:
 * 1. handleSend: atomic turn initialization, wall-clock timing, 17 SSE event handlers,
 *    and async snapshotThread microtask.
 * 2. handleStop: abort controller + sessionRpc("cancel") + completedAt mark.
 * 3. handlePermRespond & handleElicRespond: inline & dialog approval responses.
 */
export function useChatSend({
  qc,
  agentsRef,
  resolveSession,
  now = defaultNow,
  retry,
}: UseChatSendOptions) {
  const abortRef = useRef<AbortController | null>(null);
  const retryMax = retry?.max ?? DEFAULT_RETRY.max;
  const retryDelayMs = retry?.delayMs ?? DEFAULT_RETRY.delayMs;

  const handleSend = useCallback(
    async (textToSend?: string) => {
      const st = useStudioStore.getState();
      const prompt = (textToSend ?? st.input).trim();
      if ((!prompt && st.attachments.length === 0) || st.isStreaming) return;
      const agentId = st.activeAgentId;
      const blocks: Record<string, unknown>[] = [
        ...st.attachments.map((a) => a.block),
        ...(prompt ? [{ type: "text", text: prompt }] : []),
      ];
      const display =
        prompt +
        (st.attachments.length > 0
          ? `\n\n[附件: ${st.attachments.map((a) => a.name).join(", ")}]`
          : "");
      st.setInput("");
      st.setAttachments([]);

      // If currently active thread was marked stale (historical view), start fresh thread for this prompt
      const curThread0 = st.activeThreadId ? st.threads[st.activeThreadId] : undefined;
      if (curThread0?.stale) {
        st.newThread(agentId);
      }

      const assistantId = "asst-" + Date.now();
      // 发出的图片也显示在用户消息里（与历史回放一致）
      const sentImages = st.attachments
        .filter((a) => (a.block as any).type === "image" && typeof (a.block as any).data === "string")
        .map((a) => ({ src: `data:${(a.block as any).mimeType || a.mimeType};base64,${(a.block as any).data}`, mimeType: String((a.block as any).mimeType || a.mimeType) }))
        .slice(-8);
      st.appendMessage({ id: "user-" + Date.now(), role: "user", content: display, timestamp: now(), ...(sentImages.length ? { images: sentImages } : {}) });
      st.appendMessage({
        id: assistantId,
        role: "assistant",
        content: "",
        thought: "",
        plan: [],
        toolCalls: [],
        timestamp: now(),
        isStreaming: true,
        startedAt: Date.now(),
      });
      abortRef.current = new AbortController();

      // Real wall-clock timing (client-observed): tool start = first sighting,
      // tool end = first terminal status; turn end = done/error/abort.
      const TERMINAL_TOOL = new Set(["completed", "failed", "cancelled"]);
      const stampTurnEnd = (id: string) => {
        const t = Date.now();
        useStudioStore.getState().patchMessage(id, (m) => ({
          ...m,
          isStreaming: false,
          completedAt: m.completedAt ?? t,
          thoughtTiming:
            m.thoughtTiming?.startedAt && !m.thoughtTiming.completedAt
              ? { ...m.thoughtTiming, completedAt: t }
              : m.thoughtTiming,
        }));
      };

      try {
        const known = agentsRef.current.find((a) => a.id === agentId)?.status?.connected;
        if (!known) await connectAgent(agentId);
        // Always chat on a known session so model/thinking/permission state
        // stays in sync (backend auto-create would leave config unknown).
        let sid = useStudioStore.getState().sessionId;
        if (!sid) {
          // No binding: resume-first (usually news here), never blind force-new
          // over a session the UI is already showing.
          sid = await resolveSession(agentId);
          if (!sid) throw new Error("无法创建会话");
        }
        st.setStreaming(true);
        const cur = useStudioStore.getState();
        // Transient transport failures (dropped SSE, gateway hiccup) resend
        // automatically with backoff; the retry note is stripped on success.
        // Anything else (abort/auth/semantic) falls through to the handlers below.
        let attempt = 0;
        // Terminal error reporting (auth modal, ❌ note, turn stamp).
        // Stale retry notes are stripped first so a dead "retrying…" line
        // never survives next to the final error.
        const reportError = (err: any) => {
          const c2 = useStudioStore.getState();
          if (isAuthRequiredError(err)) {
            c2.setAuthOk(agentId, false);
            c2.setAuthOpen(true);
          }
          c2.patchMessage(assistantId, (m) => ({
            ...m,
            content: stripRetryNotes(m.content) + `\n\n> ❌ [${agentId}] ${err.message}`,
          }));
          stampTurnEnd(assistantId);
        };
        // Retryable when: budget left, not user-aborted, transport-level failure.
        // Auth/semantic errors and aborts are never retried.
        const shouldRetry = (err: any) =>
          attempt < retryMax &&
          !abortRef.current?.signal.aborted &&
          isTransientSendError(err);
        for (;;) {
          let failedErr: any = null;
          try {
            await consumeUniversalChat(
              { agentId, sessionId: sid, prompt: blocks },
              {
            onSessionId: (id) => cur.setSessionId(id),
            onTextChunk: (chunk) =>
              cur.patchMessage(assistantId, (m) => ({ ...m, content: m.content + chunk })),
            onThoughtChunk: (chunk) =>
              cur.patchMessage(assistantId, (m) => ({
                ...m,
                thought: (m.thought || "") + chunk,
                thoughtTiming: m.thoughtTiming ?? { startedAt: Date.now() },
              })),
            onImageChunk: (img) =>
              cur.patchMessage(assistantId, (m) => {
                const images = [...(m.images || []), img];
                if (images.length > 8) {
                  console.debug("[App] 图片附件超限，已丢弃旧图 (保留最新 8 张)");
                }
                return { ...m, images: images.slice(-8) };
              }),
            onToolCall: (c) =>
              cur.patchMessage(assistantId, (m) => ({
                ...m,
                toolCalls: [...(m.toolCalls || []), { ...c, startedAt: Date.now() }],
              })),
            onToolCallUpdate: (c) =>
              cur.patchMessage(assistantId, (m) => {
                const calls = [...(m.toolCalls || [])];
                const i = calls.findIndex((x) => x.id === c.id);
                const terminal = TERMINAL_TOOL.has(c.status);
                if (i >= 0)
                  calls[i] = {
                    ...calls[i],
                    ...c,
                    title: c.title || calls[i].title,
                    startedAt: calls[i].startedAt ?? Date.now(),
                    completedAt: terminal ? (calls[i].completedAt ?? Date.now()) : calls[i].completedAt,
                  };
                else calls.push({ ...c, startedAt: Date.now(), completedAt: terminal ? Date.now() : undefined });
                return { ...m, toolCalls: calls };
              }),
            onPlan: (entries) => cur.patchMessage(assistantId, { plan: entries }),
            onAvailableCommands: (cmds) => useStudioStore.getState().setAvailableCommands(cmds, sid),
            onModeUpdate: (modeId) => {
              const stNow = useStudioStore.getState();
              if (stNow.modes) stNow.setModes({ ...stNow.modes, currentModeId: modeId });
              useStudioStore.getState().saveAgentPref(agentId, { modeId });
            },
            onConfigUpdate: (opt) => {
              const stNow = useStudioStore.getState();
              stNow.patchConfigOption(opt);
              if (opt?.id) {
                stNow.rememberAgentConfig(
                  agentId,
                  opt.id,
                  (opt.currentValue as any)?.value ?? opt.currentValue
                );
              }
            },
            onSessionInfo: (info) => useStudioStore.getState().setSessionInfo(info),
            onUsage: (u) => {
              const c2 = useStudioStore.getState();
              const existingSize = c2.usage?.size;
              const normalized: UsageUpdate = {
                ...u,
                size: u.size > 0 ? u.size : (existingSize && existingSize > 0 ? existingSize : u.size),
              };
              c2.setUsage(normalized);
              c2.patchMessage(assistantId, { usage: normalized });
            },
            onQuota: (q) => {
              if (q) useStudioStore.getState().setQuota(q);
            },
            onActivity: (a) => appendActivityMessage(a, now(), assistantId),
            onPermissionRequest: (p) => useStudioStore.getState().addPermission(p),
            onElicitationRequest: (e) => useStudioStore.getState().addElicitation(e),
            onDone: (_stopReason, resp) => {
              if (resp && (resp.usage || resp._meta)) {
                const extras = pickUsageExtras({ ...(resp.usage || {}), _meta: resp._meta });
                const c2 = useStudioStore.getState();
                const cur = c2.usage;
                if (Object.keys(extras).length > 0) {
                  const merged: UsageUpdate = {
                    used: cur?.used ?? (typeof resp.usage?.used === "number" ? resp.usage.used : (extras.totalTokens ?? 0)),
                    size: cur?.size && cur.size > 0 ? cur.size : (typeof resp.usage?.size === "number" ? resp.usage.size : 0),
                    cost: resp.usage?.cost ?? cur?.cost,
                    ...cur,
                    ...extras,
                  };
                  c2.setUsage(merged);
                  c2.patchMessage(assistantId, { usage: merged });
                }
              }
              stampTurnEnd(assistantId);
            },
            onError: (err) => {
              // Mid-stream error frame: consumeUniversalChat reports but does
              // NOT throw, so transient ones defer to the resend below.
              if (shouldRetry(err)) {
                failedErr = err;
                return;
              }
              reportError(err);
            },
          },
          abortRef.current.signal
          );
        } catch (e: any) {
          // Pre-stream throw (connect/session/chat-POST failure).
          if (e?.name === "AbortError") throw e;
          if (isAuthRequiredError(e)) throw e;
          if (shouldRetry(e)) failedErr = e;
          else throw e;
        }
        if (!failedErr) {
          if (attempt > 0) {
            cur.patchMessage(assistantId, (m) => ({ ...m, content: stripRetryNotes(m.content) }));
          }
          break;
        }
        attempt += 1;
        cur.patchMessage(assistantId, (m) => ({
          // Trailing newline keeps the note self-delimiting: streamed text
          // lands on the next line so stripRetryNotes can never eat content.
          ...m,
          content: m.content + `\n\n> 🔁 连接中断，正在重试 (${attempt}/${retryMax})…\n`,
        }));
        // Abort during backoff surfaces as AbortError -> outer catch swallows.
        await sleepAbortable(retryDelayMs(attempt), abortRef.current?.signal);
      }
        const done = useStudioStore.getState();
        done.setAuthOk(agentId, true);

        // 自动解析状态响应中的实时额度与速率限制（例如 /status 输出）
        try {
          const finalMsg = done.messages.find((m) => m.id === assistantId);
          if (finalMsg?.content && /5-hour limit|rate limit|weekly limit|resets in|resets at|limit:/i.test(finalMsg.content)) {
            const parsed = parseRateLimitsFromStatusText(finalMsg.content);
            if (parsed && (parsed.primaryWindow || parsed.secondaryWindow)) {
              const curQuota = done.quota;
              done.setQuota({
                ...curQuota,
                ...parsed,
                account: curQuota?.account || parsed.account,
              });
            }
          }
        } catch (e) {
          console.debug("[useChatSend] 解析限额文本容错:", e);
        }

        // Fine-grained session list update:
        // 1. Do NOT invalidateAgents(qc) — agent process/capabilities do not mutate on turn-end.
        // 2. For sessions: if the active session already has a defined title (not a generic placeholder),
        //    update its updatedAt and glide it to top via in-place setQueryData (0 HTTP requests, 0 whole-tree flicker).
        // 3. For new / untitled sessions: trigger background invalidateSessions so the agent-generated title is loaded silently.
        const cachedSessions = qc.getQueryData<SessionItem[]>(acpKeys.sessions(agentId));
        const currentItem = cachedSessions?.find((s) => s.sessionId === sid);
        const hasCustomTitle =
          currentItem?.title &&
          !currentItem.title.toLowerCase().startsWith("new session") &&
          !currentItem.title.toLowerCase().startsWith("新会话");

        if (cachedSessions && hasCustomTitle) {
          const nowIso = new Date().toISOString();
          qc.setQueryData<SessionItem[]>(acpKeys.sessions(agentId), (old) => {
            if (!old) return old;
            const updated = old.map((s) =>
              s.sessionId === sid ? { ...s, updatedAt: nowIso } : s
            );
            const idx = updated.findIndex((s) => s.sessionId === sid);
            if (idx > 0) {
              const [activeItem] = updated.splice(idx, 1);
              updated.unshift(activeItem);
            }
            return updated;
          });
        } else {
          invalidateSessions(qc, agentId);
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          const c2 = useStudioStore.getState();
          if (isAuthRequiredError(e)) {
            c2.setAuthOk(agentId, false);
            c2.setAuthOpen(true);
          }
          const prev = stripRetryNotes(c2.messages.find((m) => m.id === assistantId)?.content || "");
          const msg = e?.message && e.message !== "null" ? e.message : "连接异常或请求超时";
          c2.patchMessage(assistantId, (m) => ({ ...m, content: prev + `\n\n> ❌ [连接异常] ${msg}` }));
          stampTurnEnd(assistantId);
        }
      } finally {
        const c2 = useStudioStore.getState();
        c2.setStreaming(false);
        stampTurnEnd(assistantId);
        // Turn-end marker (done / error / abort): splice this turn's final
        // text and persist ASYNC — fire-and-forget microtask so storage I/O
        // never blocks the UI thread.
        void Promise.resolve().then(() => {
          try {
            useStudioStore.getState().snapshotThread();
          } catch (err) {
            console.error("[App] turn persist failed:", err);
          }
        });
      }
    },
    [qc, agentsRef, resolveSession, now]
  );

  const handleStop = useCallback(async () => {
    abortRef.current?.abort();
    const st = useStudioStore.getState();
    if (st.sessionId) {
      try {
        await sessionRpc(st.activeAgentId, "cancel", { sessionId: st.sessionId });
      } catch {
        // ignore
      }
    }
    const cur = useStudioStore.getState();
    cur.setStreaming(false);
    const t = Date.now();
    cur.setMessages(
      cur.messages.map((m) =>
        m.isStreaming
          ? {
              ...m,
              isStreaming: false,
              completedAt: m.completedAt ?? t,
              thoughtTiming:
                m.thoughtTiming?.startedAt && !m.thoughtTiming.completedAt
                  ? { ...m.thoughtTiming, completedAt: t }
                  : m.thoughtTiming,
            }
          : m
      )
    );
  }, []);

  const handlePermRespond = useCallback(
    async (p: PendingPermission, optionId: string | null) => {
      const st = useStudioStore.getState();
      st.setRespondingId(p.permissionId);
      try {
        await respondPermission(
          p.agentId,
          p.permissionId,
          optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" }
        );
        useStudioStore.getState().removePermission(p.permissionId);
      } catch (e: any) {
        alert(`permission respond 失败: ${e.message}`);
      } finally {
        useStudioStore.getState().setRespondingId(null);
      }
    },
    []
  );

  const handleElicRespond = useCallback(
    async (e: PendingElicitation, accept: boolean, payload?: unknown) => {
      const st = useStudioStore.getState();
      st.setRespondingId(e.elicitationId);
      try {
        const result = accept ? { action: "accept", content: payload ?? {} } : { action: "decline" };
        await respondElicitation(e.agentId, e.elicitationId, result);
        useStudioStore.getState().removeElicitation(e.elicitationId);
      } catch (err: any) {
        alert(`elicitation respond 失败: ${err.message}`);
      } finally {
        useStudioStore.getState().setRespondingId(null);
      }
    },
    []
  );

  return {
    abortRef,
    handleSend,
    handleStop,
    handlePermRespond,
    handleElicRespond,
  };
}
