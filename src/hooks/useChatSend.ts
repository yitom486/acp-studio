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
  type ActivityEvent,
  type AgentSummary,
  type PendingPermission,
  type PendingElicitation,
} from "@/lib/universal-api";

export interface UseChatSendOptions {
  qc: QueryClient;
  agentsRef: React.MutableRefObject<AgentSummary[]>;
  resolveSession: (agentId: string) => Promise<string | null>;
  now?: () => string;
}

const defaultNow = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Appends a formatted system message for non-chat activity notifications (fs, terminal, compaction). */
export function appendActivityMessage(a: ActivityEvent, timestamp: string) {
  if (!a?.kind || a.kind === "session_info_update" || a.kind.endsWith("_update") || a.kind === "plan") {
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
  let summary = "";
  try {
    const d: any = a.detail || {};
    summary = d.path || d.command || d.terminalId || d.status || (typeof d === "string" ? d : "");
  } catch {
    summary = "";
  }
  if (!summary) return;
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
}: UseChatSendOptions) {
  const abortRef = useRef<AbortController | null>(null);

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

      const assistantId = "asst-" + Date.now();
      st.appendMessage({ id: "user-" + Date.now(), role: "user", content: display, timestamp: now() });
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
            onAvailableCommands: (cmds) => cur.setAvailableCommands(cmds),
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
              c2.setUsage(u);
              c2.patchMessage(assistantId, { usage: u });
            },
            onActivity: (a) => appendActivityMessage(a, now()),
            onPermissionRequest: (p) => useStudioStore.getState().addPermission(p),
            onElicitationRequest: (e) => useStudioStore.getState().addElicitation(e),
            onDone: () => stampTurnEnd(assistantId),
            onError: (err) => {
              const c2 = useStudioStore.getState();
              if (isAuthRequiredError(err)) {
                c2.setAuthOk(agentId, false);
                c2.setAuthOpen(true);
              }
              c2.patchMessage(assistantId, (m) => ({
                ...m,
                content: m.content + `\n\n> ❌ [${agentId}] ${err.message}`,
              }));
              stampTurnEnd(assistantId);
            },
          },
          abortRef.current.signal
        );
        const done = useStudioStore.getState();
        done.setAuthOk(agentId, true);

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
          const prev = c2.messages.find((m) => m.id === assistantId)?.content || "";
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
