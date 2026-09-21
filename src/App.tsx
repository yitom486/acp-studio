import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChatArea } from "./components/ChatArea";
import { AgentBar } from "./components/universal/AgentBar";
import { Sidebar, type SessionItem } from "./components/universal/Sidebar";
import { SessionControls } from "./components/universal/SessionControls";
import { SessionSettingsModal, type SessionSettings } from "./components/universal/SessionSettingsModal";
import { ProvidersModal } from "./components/universal/ProvidersModal";
import { PermissionDialog } from "./components/universal/PermissionDialog";
import { ElicitationCard } from "./components/universal/ElicitationCard";
import { UniversalAuthModal } from "./components/universal/AuthModal";
import { UniversalComposer } from "./components/universal/UniversalComposer";
import { CustomAgentModal } from "./components/universal/CustomAgentModal";
import { GitChangesModal } from "./components/universal/GitChangesModal";
import { ModelBrowserModal } from "./components/universal/ModelBrowserModal";
import { useStudioStore } from "./stores/useStudioStore";
import { useAgentsQuery, useSessionsQuery, invalidateAgents, invalidateSessions } from "./lib/acp-queries";
import {
  connectAgent,
  logoutAgent,
  sessionNew,
  sessionRpc,
  loadSession,
  forkSession,
  respondPermission,
  respondElicitation,
  consumeUniversalChat,
  buildTranscriptFromReplay,
  findConfigOption,
  parseModelId,
  isAuthRequiredError,
  type PendingPermission,
  type PendingElicitation,
  type ActivityEvent,
} from "./lib/universal-api";

/**
 * ACP Studio Universal — full ACP v1 client.
 * State: zustand (client) + TanStack Query (server). See
 * .agents/rules/state_management.md for the conventions.
 */
export default function App() {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const ensuredRef = useRef<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const s = useStudioStore();

  // Server state (TanStack Query)
  const agentsQuery = useAgentsQuery();
  const agents = agentsQuery.data ?? [];
  const activeAgent = agents.find((a) => a.id === s.activeAgentId);
  const connected = !!activeAgent?.status?.connected;
  const sessionsQuery = useSessionsQuery(s.activeAgentId, connected);
  const sessions = sessionsQuery.data ?? [];
  const sessionCwd = sessions.find((x) => x.sessionId === s.sessionId)?.cwd || null;

  const caps = (activeAgent?.status?.agentCapabilities || {}) as any;
  const sessionCaps = (caps.sessionCapabilities || {}) as Record<string, unknown>;
  const promptCaps = (caps.promptCapabilities || {}) as Record<string, unknown>;
  const mcpCaps = (caps.mcpCapabilities || {}) as Record<string, unknown>;
  const supportsList = "list" in sessionCaps;
  const supportsFork = "fork" in sessionCaps;
  const supportsProviders = !!caps.providers;
  const supportsAdditionalDirs = "additionalDirectories" in sessionCaps;
  const supportImage = !!promptCaps.image;

  // Keep the selected agent valid as the registry list arrives/changes.
  useEffect(() => {
    if (agents.length > 0 && !agents.find((a) => a.id === s.activeAgentId)) {
      s.setActiveAgentId(agents[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  // One-time: probe local-auth reuse for connected agents + ensure a session
  // for the active one (StrictMode-safe via ensuredRef).
  useEffect(() => {
    if (agentsQuery.isLoading || agents.length === 0) return;
    void (async () => {
      for (const a of agents) {
        if (a.status?.connected && s.authOk[a.id] === undefined) {
          await probeAuth(a.id);
        }
      }
      const active = agents.find((a) => a.id === useStudioStore.getState().activeAgentId);
      if (active?.status?.connected && ensuredRef.current !== active.id) {
        ensuredRef.current = active.id;
        await ensureSession(active.id, true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentsQuery.isLoading, agents]);

  const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  /**
   * Non-mutating local-auth probe: session/list succeeds without any
   * authenticate call iff the agent reuses local login state
   * (e.g. codex reading ~/.codex/auth.json).
   */
  const probeAuth = async (agentId: string) => {
    try {
      await sessionRpc(agentId, "list", {});
      useStudioStore.getState().setAuthOk(agentId, true);
    } catch (e: any) {
      useStudioStore.getState().setAuthOk(agentId, isAuthRequiredError(e) ? false : null);
    }
  };

  /** Create a session on demand (e.g. user tweaks model/thinking before chatting). */
  const ensureSession = async (agentId: string = s.activeAgentId, force = false): Promise<string | null> => {
    const st = useStudioStore.getState();
    if (!force && st.sessionId && agentId === st.activeAgentId) return st.sessionId;
    if (st.isStreaming || st.busy) return null;
    try {
      const known = agents.find((a) => a.id === agentId)?.status?.connected;
      if (!known) await connectAgent(agentId);
      const res: any = await sessionNew(agentId, {});
      st.applySessionResult(res);
      st.setAuthOk(agentId, true);
      invalidateSessions(qc, agentId);
      invalidateAgents(qc);
      return res?.sessionId || null;
    } catch (e: any) {
      if (isAuthRequiredError(e)) {
        st.setAuthOk(agentId, false);
        st.setAuthOpen(true);
      } else {
        const msg = e?.message && e.message !== "null" ? e.message : "无法创建会话（Agent进程未连接或异常）";
        alert(`创建会话失败: ${msg}`);
      }
      return null;
    }
  };

  // Switching agent resets session-scoped state (sessions live per-agent on gateway)
  const handleSelectAgent = (id: string) => {
    const st = useStudioStore.getState();
    if (id === st.activeAgentId) return;
    abortRef.current?.abort();
    st.setActiveAgentId(id);
    st.setSessionId(null);
    st.resetThread();
    const target = agents.find((a) => a.id === id);
    if (target?.status?.connected) {
      invalidateSessions(qc, id);
      ensuredRef.current = id;
      void ensureSession(id, true);
    }
  };

  const handleConnect = async (id: string = s.activeAgentId) => {
    const st = useStudioStore.getState();
    st.setConnectingId(id);
    try {
      await connectAgent(id);
      invalidateAgents(qc);
      await probeAuth(id);
      invalidateSessions(qc, id);
      // Auto-create a session so model/thinking/permission selectors
      // (which come from session configOptions) show up immediately.
      if (id === useStudioStore.getState().activeAgentId && !useStudioStore.getState().sessionId) {
        ensuredRef.current = id;
        await ensureSession(id);
      }
    } catch (e: any) {
      const msg = e?.message && e.message !== "null" ? e.message : "连接超时或进程异常退出";
      alert(`连接 ${id} 失败: ${msg}`);
    } finally {
      useStudioStore.getState().setConnectingId(null);
    }
  };

  const handleCreateSession = async (settings: SessionSettings) => {
    const st = useStudioStore.getState();
    const agentId = st.activeAgentId;
    st.setBusy(true);
    try {
      const known = agents.find((a) => a.id === agentId)?.status?.connected;
      if (!known) await connectAgent(agentId);
      const res: any = await sessionNew(agentId, {
        ...(settings.cwd ? { cwd: settings.cwd } : {}),
        ...(settings.additionalDirectories.length > 0 ? { additionalDirectories: settings.additionalDirectories } : {}),
        mcpServers: settings.mcpServers,
      });
      st.applySessionResult(res);
      st.resetThread();
      st.setAuthOk(agentId, true);
      st.setSettingsOpen(false);
      invalidateAgents(qc);
      invalidateSessions(qc, agentId);
    } catch (e: any) {
      if (isAuthRequiredError(e)) {
        st.setAuthOk(agentId, false);
        st.setSettingsOpen(false);
        st.setAuthOpen(true);
      } else {
        alert(`session/new 失败: ${e.message}`);
      }
    } finally {
      useStudioStore.getState().setBusy(false);
    }
  };

  /** Shared session/set_config_option with correct select/boolean shapes. */
  const setSessionConfig = async (configId: string, value: unknown) => {
    const st = useStudioStore.getState();
    const sid = st.sessionId || (await ensureSession());
    if (!sid) return;
    try {
      const opt = useStudioStore.getState().configOptions?.find((c) => c.id === configId);
      const body: Record<string, unknown> =
        opt?.type === "boolean" || typeof value === "boolean"
          ? { sessionId: sid, configId, type: "boolean", value }
          : { sessionId: sid, configId, value };
      const res: any = await sessionRpc(st.activeAgentId, "set_config", body);
      const cur = useStudioStore.getState();
      if (res?.configOptions) cur.setConfigOptions(res.configOptions);
      else if (Array.isArray(res)) cur.setConfigOptions(res);
      else cur.patchConfigOption({ ...(opt || { id: configId }), currentValue: value });
    } catch (e: any) {
      alert(`set_config 失败: ${e.message}`);
    }
  };

  const appendActivity = (a: ActivityEvent) => {
    const icon =
      a.kind === "fs_read" ? "📖" : a.kind === "fs_write" ? "📝" : a.kind.startsWith("terminal") ? "▶️" : a.kind.startsWith("compaction") ? "🗜️" : a.kind.startsWith("plan") ? "📋" : "🔧";
    let summary = "";
    try {
      const d: any = a.detail || {};
      summary = d.path || d.command || d.terminalId || d.status || JSON.stringify(d).slice(0, 160);
    } catch {
      summary = "";
    }
    const line = `${icon} [${a.kind}] ${summary}`.trim();
    useStudioStore.getState().appendMessage({ id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: line, timestamp: now() });
  };

  /** Open a session from the sidebar: load (with replay), resume, else attach bare. */
  const handleOpenSession = async (item: SessionItem) => {
    const st = useStudioStore.getState();
    if (st.isStreaming) return;
    const agentId = st.activeAgentId;
    st.setBusy(true);
    try {
      const known = agents.find((a) => a.id === agentId)?.status?.connected;
      if (!known) await connectAgent(agentId);
      try {
        const { result, replayed } = await loadSession(agentId, {
          sessionId: item.sessionId,
          cwd: item.cwd,
          mcpServers: [],
        });
        const t = buildTranscriptFromReplay(replayed || []);
        const cur = useStudioStore.getState();
        cur.setSessionId(item.sessionId);
        cur.setMessages(
          t.messages.map((m, i) => ({
            id: `hist-${Date.now()}-${i}`,
            role: m.role,
            content: m.content,
            thought: m.thought,
            toolCalls: m.toolCalls,
            timestamp: now(),
          }))
        );
        if (t.plan.length > 0) {
          const msgs = useStudioStore.getState().messages;
          const lastAsst = [...msgs].reverse().find((m) => m.role === "assistant");
          if (lastAsst) useStudioStore.getState().patchMessage(lastAsst.id, { plan: t.plan });
        }
        if (t.usage) useStudioStore.getState().setUsage(t.usage);
        if (t.availableCommands.length > 0) useStudioStore.getState().setAvailableCommands(t.availableCommands);
        if (t.currentModeId) {
          const modes = useStudioStore.getState().modes;
          if (modes) useStudioStore.getState().setModes({ ...modes, currentModeId: t.currentModeId! });
        }
        for (const a of t.activities) appendActivity(a);
        const r: any = result || {};
        const cur2 = useStudioStore.getState();
        if (r.modes) cur2.setModes(r.modes);
        if (r.models) cur2.setModels(r.models);
        if (r.configOptions) cur2.setConfigOptions(r.configOptions);
        cur2.setAuthOk(agentId, true);
      } catch {
        // Fall back to resume (no replay) when load is unsupported/fails.
        try {
          await sessionRpc(agentId, "resume", { sessionId: item.sessionId, cwd: item.cwd, mcpServers: [] });
          const cur = useStudioStore.getState();
          cur.setSessionId(item.sessionId);
          cur.resetThread();
          cur.setMessages([{ id: `sys-${Date.now()}`, role: "system", content: `已 resume 会话（无历史回放）。`, timestamp: now() }]);
        } catch {
          // Some agents reject load/resume while session/prompt on the same
          // id still works — attach bare instead of hitting a dead end.
          const cur = useStudioStore.getState();
          cur.setSessionId(item.sessionId);
          cur.resetThread();
          cur.setMessages([{ id: `sys-${Date.now()}`, role: "system", content: `已切换到会话（该 Agent 未提供历史回放，直接继续对话即可）。`, timestamp: now() }]);
        }
      }
      invalidateSessions(qc, agentId);
    } catch (e: any) {
      alert(`打开会话失败: ${e.message}`);
    } finally {
      useStudioStore.getState().setBusy(false);
    }
  };

  const handleForkSession = async (sid?: string) => {
    const st = useStudioStore.getState();
    const source = sid || st.sessionId;
    if (!source || st.isStreaming) return;
    const agentId = st.activeAgentId;
    st.setBusy(true);
    try {
      const listed = sessionsQuery.data ?? [];
      const info = listed.find((x) => x.sessionId === source);
      const res: any = await forkSession(agentId, {
        sessionId: source,
        ...(info?.cwd ? { cwd: info.cwd } : {}),
      });
      const cur = useStudioStore.getState();
      cur.applySessionResult(res);
      cur.resetThread();
      cur.setMessages([{ id: `sys-${Date.now()}`, role: "system", content: `已从 ${source.slice(0, 8)}… fork 出新会话。`, timestamp: now() }]);
      invalidateSessions(qc, agentId);
    } catch (e: any) {
      alert(`fork 失败: ${e.message}`);
    } finally {
      useStudioStore.getState().setBusy(false);
    }
  };

  const handleDeleteSession = async (item: SessionItem) => {
    if (!confirm(`删除会话 ${item.title || item.sessionId}？`)) return;
    const st = useStudioStore.getState();
    const agentId = st.activeAgentId;
    try {
      await sessionRpc(agentId, "delete", { sessionId: item.sessionId });
      const cur = useStudioStore.getState();
      if (item.sessionId === cur.sessionId) {
        cur.setSessionId(null);
        cur.resetThread();
      }
      invalidateSessions(qc, agentId);
    } catch (e: any) {
      // Some agents reject delete — fall back to close (frees active resources).
      try {
        await sessionRpc(agentId, "close", { sessionId: item.sessionId });
        const cur = useStudioStore.getState();
        if (item.sessionId === cur.sessionId) {
          cur.setSessionId(null);
          cur.resetThread();
        }
        cur.appendMessage({ id: `sys-${Date.now()}`, role: "system", content: `该 Agent 不支持 delete，已改用 close。`, timestamp: now() });
        invalidateSessions(qc, agentId);
      } catch {
        alert(`删除失败: ${(e as Error).message}`);
      }
    }
  };

  /** Re-discover the model catalog via a throwaway session (closed afterwards). */
  const handleDiscoverModels = async () => {
    const st = useStudioStore.getState();
    if (st.discovering || st.isStreaming) return;
    const agentId = st.activeAgentId;
    st.setDiscovering(true);
    try {
      const known = agents.find((a) => a.id === agentId)?.status?.connected;
      if (!known) await connectAgent(agentId);
      const res: any = await sessionNew(agentId, {});
      const cur = useStudioStore.getState();
      if (res?.models) {
        cur.setModels(res.models);
        if (!cur.sessionId) cur.applySessionResult(res);
      }
      if (res?.sessionId && res.sessionId !== useStudioStore.getState().sessionId) {
        await sessionRpc(agentId, "close", { sessionId: res.sessionId }).catch(() => undefined);
      }
      cur.setAuthOk(agentId, true);
    } catch (e: any) {
      alert(`发现模型失败: ${e.message}`);
    } finally {
      useStudioStore.getState().setDiscovering(false);
    }
  };

  /** Fallback model switch for agents without a model config option. */
  const handleFallbackModel = async (modelId: string) => {
    const st = useStudioStore.getState();
    const modelOpt = findConfigOption(st.configOptions, "model");
    if (modelOpt) {
      await setSessionConfig(modelOpt.id, parseModelId(modelId).model);
      return;
    }
    const sid = st.sessionId || (await ensureSession());
    if (!sid) return;
    try {
      // Legacy agy-style servers implement session/set_model directly.
      await sessionRpc(st.activeAgentId, "set_model", { sessionId: sid, modelId });
      const cur = useStudioStore.getState();
      if (cur.models) cur.setModels({ ...cur.models, currentModelId: modelId });
    } catch (e: any) {
      alert(`切换模型失败: ${e.message}`);
    }
  };

  /** Apply a catalog modelId (e.g. "gpt-5.6-luna[xhigh]") + linked thinking level. */
  const handleApplyModel = async (modelId: string) => {
    const st = useStudioStore.getState();
    const { model, effort } = parseModelId(modelId);
    const modelOpt = findConfigOption(st.configOptions, "model");
    await setSessionConfig(modelOpt?.id || "model", model);
    if (effort) {
      const cur = useStudioStore.getState();
      const thinkOpt = findConfigOption(cur.configOptions, "thinking");
      if (thinkOpt && (thinkOpt.options || []).some((o) => String(o.value) === effort)) {
        await setSessionConfig(thinkOpt.id, effort);
      }
    }
    const cur2 = useStudioStore.getState();
    if (cur2.models) cur2.setModels({ ...cur2.models, currentModelId: modelId });
    cur2.setModelsOpen(false);
  };

  const handleSend = async (textToSend?: string) => {
    const st = useStudioStore.getState();
    const prompt = (textToSend ?? st.input).trim();
    if ((!prompt && st.attachments.length === 0) || st.isStreaming) return;
    const agentId = st.activeAgentId;
    const blocks: Record<string, unknown>[] = [
      ...st.attachments.map((a) => a.block),
      ...(prompt ? [{ type: "text", text: prompt }] : []),
    ];
    const display = prompt + (st.attachments.length > 0 ? `\n\n[附件: ${st.attachments.map((a) => a.name).join(", ")}]` : "");
    st.setInput("");
    st.setAttachments([]);

    const assistantId = "asst-" + Date.now();
    st.appendMessage({ id: "user-" + Date.now(), role: "user", content: display, timestamp: now() });
    st.appendMessage({ id: assistantId, role: "assistant", content: "", thought: "", plan: [], toolCalls: [], timestamp: now(), isStreaming: true });
    st.setStreaming(true);
    abortRef.current = new AbortController();

    try {
      const known = agents.find((a) => a.id === agentId)?.status?.connected;
      if (!known) await connectAgent(agentId);
      // Always chat on a known session so model/thinking/permission state
      // stays in sync (backend auto-create would leave config unknown).
      let sid = useStudioStore.getState().sessionId;
      if (!sid) {
        sid = await ensureSession(agentId);
        if (!sid) throw new Error("无法创建会话");
      }
      const cur = useStudioStore.getState();
      await consumeUniversalChat(
        { agentId, sessionId: sid, prompt: blocks },
        {
          onSessionId: (id) => cur.setSessionId(id),
          onTextChunk: (chunk) =>
            cur.patchMessage(assistantId, (m) => ({ ...m, content: m.content + chunk })),
          onThoughtChunk: (chunk) =>
            cur.patchMessage(assistantId, (m) => ({ ...m, thought: (m.thought || "") + chunk })),
          onToolCall: (c) =>
            cur.patchMessage(assistantId, (m) => ({ ...m, toolCalls: [...(m.toolCalls || []), c] })),
          onToolCallUpdate: (c) =>
            cur.patchMessage(assistantId, (m) => {
              const calls = [...(m.toolCalls || [])];
              const i = calls.findIndex((x) => x.id === c.id);
              if (i >= 0) calls[i] = { ...calls[i], ...c, title: c.title || calls[i].title };
              else calls.push(c);
              return { ...m, toolCalls: calls };
            }),
          onPlan: (entries) => cur.patchMessage(assistantId, { plan: entries }),
          onAvailableCommands: (cmds) => cur.setAvailableCommands(cmds),
          onModeUpdate: (modeId) => {
            const modes = useStudioStore.getState().modes;
            if (modes) useStudioStore.getState().setModes({ ...modes, currentModeId: modeId });
          },
          onConfigUpdate: (opt) => useStudioStore.getState().patchConfigOption(opt),
          onSessionInfo: (info) => useStudioStore.getState().setSessionInfo(info),
          onUsage: (u) => {
            const c2 = useStudioStore.getState();
            c2.setUsage(u);
            c2.patchMessage(assistantId, { usage: u });
          },
          onActivity: (a) => appendActivity(a),
          onPermissionRequest: (p) => useStudioStore.getState().addPermission(p),
          onElicitationRequest: (e) => useStudioStore.getState().addElicitation(e),
          onDone: () => useStudioStore.getState().patchMessage(assistantId, { isStreaming: false }),
          onError: (err) => {
            const c2 = useStudioStore.getState();
            if (isAuthRequiredError(err)) {
              c2.setAuthOk(agentId, false);
              c2.setAuthOpen(true);
            }
            c2.patchMessage(assistantId, {
              content: c2.messages.find((m) => m.id === assistantId)?.content + `\n\n> ❌ [${agentId}] ${err.message}`,
              isStreaming: false,
            });
          },
        },
        abortRef.current.signal
      );
      const done = useStudioStore.getState();
      done.setAuthOk(agentId, true);
      invalidateAgents(qc);
      invalidateSessions(qc, agentId);
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        const c2 = useStudioStore.getState();
        if (isAuthRequiredError(e)) {
          c2.setAuthOk(agentId, false);
          c2.setAuthOpen(true);
        }
        const prev = c2.messages.find((m) => m.id === assistantId)?.content || "";
        const msg = e?.message && e.message !== "null" ? e.message : "连接异常或请求超时";
        c2.patchMessage(assistantId, { content: prev + `\n\n> ❌ [连接异常] ${msg}`, isStreaming: false });
      }
    } finally {
      const c2 = useStudioStore.getState();
      c2.setStreaming(false);
      c2.patchMessage(assistantId, { isStreaming: false });
    }
  };

  const handleStop = async () => {
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
    cur.setMessages(cur.messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  };

  const handlePermRespond = async (p: PendingPermission, optionId: string | null) => {
    const st = useStudioStore.getState();
    st.setRespondingId(p.permissionId);
    try {
      await respondPermission(p.agentId, p.permissionId, optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" });
      useStudioStore.getState().removePermission(p.permissionId);
    } catch (e: any) {
      alert(`permission respond 失败: ${e.message}`);
    } finally {
      useStudioStore.getState().setRespondingId(null);
    }
  };

  const handleElicRespond = async (e: PendingElicitation, accept: boolean, payload?: unknown) => {
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
  };

  return (
    <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden select-text">
      <Sidebar
        agents={agents}
        activeAgentId={s.activeAgentId}
        onSelectAgent={handleSelectAgent}
        onConnectAgent={handleConnect}
        connectingId={s.connectingId}
        authOk={s.authOk}
        sessions={sessions}
        sessionsLoading={sessionsQuery.isFetching}
        activeSessionId={s.sessionId}
        onRefreshSessions={() => invalidateSessions(qc, s.activeAgentId)}
        onNewSession={() => s.setSettingsOpen(true)}
        onOpenSession={handleOpenSession}
        onForkSession={(item) => handleForkSession(item.sessionId)}
        onDeleteSession={handleDeleteSession}
        supportsFork={supportsFork}
        supportsList={supportsList}
        onOpenProviders={() => s.setProvidersOpen(true)}
        supportsProviders={supportsProviders}
        onManageCustom={() => setCustomOpen(true)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 border-b border-border/80 bg-background/80 px-5 flex items-center gap-3 shrink-0">
          <div>
            <h1 className="font-bold text-sm">ACP Studio <span className="text-primary">Universal</span></h1>
            <p className="text-[10px] text-muted-foreground font-mono">
              {activeAgent?.title || s.activeAgentId} · ACP v{activeAgent?.status?.protocolVersion ?? "?"}
              {s.sessionId ? ` · ${s.sessionId.slice(0, 13)}…` : " · 无会话"}
            </p>
          </div>
          <div className="flex-1" />
          <button onClick={() => s.setSettingsOpen(true)} disabled={s.isStreaming || s.busy} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40">新会话</button>
          <button onClick={() => !s.isStreaming && s.setMessages([])} disabled={s.isStreaming} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40">清空</button>
        </div>

        <AgentBar
          agents={agents}
          activeAgentId={s.activeAgentId}
          onSelect={handleSelectAgent}
          onConnect={() => handleConnect()}
          connecting={s.connectingId === s.activeAgentId}
          onOpenAuth={() => s.setAuthOpen(true)}
          onLogout={async () => {
            try {
              await logoutAgent(s.activeAgentId);
              invalidateAgents(qc);
            } catch (e: any) {
              alert(`logout 失败: ${e.message}`);
            }
          }}
          authOk={s.authOk[s.activeAgentId] ?? null}
        />

        <SessionControls
          sessionId={s.sessionId}
          modes={s.modes}
          configOptions={s.configOptions}
          availableCommands={s.availableCommands}
          usage={s.usage}
          sessionInfo={s.sessionInfo}
          capabilities={activeAgent?.status?.agentCapabilities}
          onNewSession={() => s.setSettingsOpen(true)}
          onCloseSession={async () => {
            const cur = useStudioStore.getState();
            if (!cur.sessionId) return;
            await sessionRpc(cur.activeAgentId, "close", { sessionId: cur.sessionId }).catch((e: any) => alert(e.message));
            cur.setSessionId(null);
            invalidateSessions(qc, cur.activeAgentId);
          }}
          onDeleteSession={async () => {
            const cur = useStudioStore.getState();
            if (!cur.sessionId) return;
            if (!confirm(`删除会话 ${cur.sessionId}？`)) return;
            await sessionRpc(cur.activeAgentId, "delete", { sessionId: cur.sessionId }).catch((e: any) => alert(e.message));
            cur.setSessionId(null);
            cur.resetThread();
            invalidateSessions(qc, cur.activeAgentId);
          }}
          onListSessions={async () => {
            invalidateSessions(qc, useStudioStore.getState().activeAgentId);
          }}
          onSetMode={async (modeId) => {
            const cur = useStudioStore.getState();
            if (!cur.sessionId) return;
            try {
              await sessionRpc(cur.activeAgentId, "set_mode", { sessionId: cur.sessionId, modeId });
              if (cur.modes) cur.setModes({ ...cur.modes, currentModeId: modeId });
            } catch (e: any) {
              alert(`set_mode 失败: ${e.message}`);
            }
          }}
          onSetConfig={(configId, value) => setSessionConfig(configId, value)}
          onInsertCommand={(cmd) => useStudioStore.getState().setInput(`${useStudioStore.getState().input ? useStudioStore.getState().input + " " : ""}${cmd}`)}
          onForkSession={() => handleForkSession()}
          onOpenProviders={() => s.setProvidersOpen(true)}
          onOpenChanges={() => setChangesOpen(true)}
          hasChangesCwd={!!sessionCwd}
          supportsFork={supportsFork}
          supportsProviders={supportsProviders}
          busy={s.busy || s.isStreaming}
        />

        <PermissionDialog pending={s.pendingPerms.filter((p) => !s.sessionId || p.sessionId === s.sessionId)} onRespond={handlePermRespond} respondingId={s.respondingId} />

        {s.pendingElic.length > 0 && (
          <div className="px-4 pt-2 space-y-2 max-h-64 overflow-y-auto shrink-0">
            {s.pendingElic.map((e) => (
              <ElicitationCard key={e.elicitationId} e={e} onRespond={handleElicRespond} busy={s.respondingId === e.elicitationId} />
            ))}
          </div>
        )}

        <ChatArea
          messages={s.messages}
          isStreaming={s.isStreaming}
          selectedModel={activeAgent?.title || s.activeAgentId}
          selectedMode={s.modes?.currentModeId || ""}
          onSelectSuggestion={(p) => handleSend(p)}
          agentName={activeAgent?.title || activeAgent?.name || "Agent"}
        />

        <UniversalComposer
          input={s.input}
          setInput={(v) => s.setInput(v)}
          onSend={(t) => handleSend(t)}
          onStop={handleStop}
          onClear={() => !s.isStreaming && s.setMessages([])}
          isStreaming={s.isStreaming}
          commands={s.availableCommands}
          supportImage={supportImage}
          attachments={s.attachments}
          setAttachments={(a) => s.setAttachments(a)}
          agentTitle={activeAgent?.title || s.activeAgentId}
          configOptions={s.configOptions}
          onSetConfig={(configId, value) => setSessionConfig(configId, value)}
          onBrowseModels={() => s.setModelsOpen(true)}
          hasModelCatalog={!!s.models}
          connected={connected}
          fallbackModels={s.models?.availableModels || null}
          fallbackCurrentModel={s.models?.currentModelId || ""}
          onFallbackModel={handleFallbackModel}
          onEnsureSession={() => ensureSession()}
        />
      </div>

      <UniversalAuthModal
        isOpen={s.authOpen}
        onClose={() => s.setAuthOpen(false)}
        agent={activeAgent}
        onAuthenticated={async () => {
          invalidateAgents(qc);
          await probeAuth(useStudioStore.getState().activeAgentId);
        }}
        onLogout={async () => {
          try {
            await logoutAgent(s.activeAgentId);
            invalidateAgents(qc);
          } catch (e: any) {
            alert(`logout 失败: ${e.message}`);
          }
        }}
        authOk={s.authOk[s.activeAgentId] ?? null}
      />

      <SessionSettingsModal
        isOpen={s.settingsOpen}
        onClose={() => s.setSettingsOpen(false)}
        onCreate={handleCreateSession}
        busy={s.busy}
        supportsAdditionalDirs={supportsAdditionalDirs}
        supportsMcpHttp={!!mcpCaps.http}
      />

      <ProvidersModal isOpen={s.providersOpen} onClose={() => s.setProvidersOpen(false)} agentId={s.activeAgentId} />

      <CustomAgentModal
        isOpen={customOpen}
        onClose={() => setCustomOpen(false)}
        agents={agents}
        onChanged={() => invalidateAgents(qc)}
      />

      <GitChangesModal
        isOpen={changesOpen}
        onClose={() => setChangesOpen(false)}
        cwd={sessionCwd}
      />

      <ModelBrowserModal
        isOpen={s.modelsOpen}
        onClose={() => s.setModelsOpen(false)}
        catalog={s.models}
        modelOption={findConfigOption(s.configOptions, "model")}
        currentModelId={s.models?.currentModelId}
        discovering={s.discovering}
        onRefresh={handleDiscoverModels}
        onApply={handleApplyModel}
      />
    </div>
  );
}
