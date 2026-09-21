import React, { useState, useEffect, useRef } from "react";
import { ChatArea, Message } from "./components/ChatArea";
import { AgentBar } from "./components/universal/AgentBar";
import { Sidebar, type SessionItem } from "./components/universal/Sidebar";
import { SessionControls } from "./components/universal/SessionControls";
import { SessionSettingsModal, type SessionSettings } from "./components/universal/SessionSettingsModal";
import { ProvidersModal } from "./components/universal/ProvidersModal";
import { PermissionDialog } from "./components/universal/PermissionDialog";
import { ElicitationCard } from "./components/universal/ElicitationCard";
import { UniversalAuthModal } from "./components/universal/AuthModal";
import { UniversalComposer, type Attachment } from "./components/universal/UniversalComposer";
import {
  fetchAgents,
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
  type AgentSummary,
  type PendingPermission,
  type PendingElicitation,
  type ActivityEvent,
} from "./lib/universal-api";

/**
 * ACP Studio Universal — full ACP v1 client.
 * Agents: codex / gemini / claude / opencode / copilot / cursor / antigravity-stdio.
 */
export default function App() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>("codex");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [modes, setModes] = useState<{ currentModeId?: string; availableModes?: Array<{ id: string; name?: string }> } | null>(null);
  const [configOptions, setConfigOptions] = useState<any[] | null>(null);
  const [availableCommands, setAvailableCommands] = useState<Array<{ name: string; description?: string }>>([]);
  const [usage, setUsage] = useState<{ used: number; size: number; cost?: { amount: number; currency: string } } | null>(null);
  const [sessionInfo, setSessionInfo] = useState<any>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [pendingPerms, setPendingPerms] = useState<PendingPermission[]>([]);
  const [pendingElic, setPendingElic] = useState<PendingElicitation[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authOk, setAuthOk] = useState<Record<string, boolean | null>>({});

  const abortRef = useRef<AbortController | null>(null);
  const activeAgent = agents.find((a) => a.id === activeAgentId);
  const caps = (activeAgent?.status?.agentCapabilities || {}) as any;
  const sessionCaps = (caps.sessionCapabilities || {}) as Record<string, unknown>;
  const promptCaps = (caps.promptCapabilities || {}) as Record<string, unknown>;
  const mcpCaps = (caps.mcpCapabilities || {}) as Record<string, unknown>;
  const supportsList = "list" in sessionCaps;
  const supportsFork = "fork" in sessionCaps;
  const supportsProviders = !!caps.providers;
  const supportsAdditionalDirs = "additionalDirectories" in sessionCaps;
  const supportImage = !!promptCaps.image;

  const refreshAgents = async () => {
    try {
      const list = await fetchAgents();
      setAgents(list);
      if (!list.find((a) => a.id === activeAgentId) && list.length > 0) {
        setActiveAgentId(list[0].id);
      }
    } catch (e) {
      console.error("fetchAgents failed", e);
    }
  };

  const refreshSessions = async (agentId: string = activeAgentId) => {
    setSessionsLoading(true);
    try {
      const res: any = await sessionRpc(agentId, "list", {});
      const items = res?.sessions || [];
      setSessions(
        (Array.isArray(items) ? items : []).map((s: any) => ({
          sessionId: s.sessionId || s.id,
          title: s.title,
          cwd: s.cwd,
          updatedAt: s.updatedAt,
        }))
      );
    } catch {
      // list unsupported or failed — sidebar shows hint
    } finally {
      setSessionsLoading(false);
    }
  };

  /**
   * Non-mutating local-auth probe: session/list succeeds without any
   * authenticate call iff the agent reuses local login state
   * (e.g. codex reading ~/.codex/auth.json).
   */
  const probeAuth = async (agentId: string) => {
    try {
      await sessionRpc(agentId, "list", {});
      setAuthOk((prev) => ({ ...prev, [agentId]: true }));
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (/auth/i.test(msg)) setAuthOk((prev) => ({ ...prev, [agentId]: false }));
      else setAuthOk((prev) => ({ ...prev, [agentId]: null }));
    }
  };

  useEffect(() => {
    refreshAgents().then(async () => {
      try {
        const list = await fetchAgents();
        for (const a of list) {
          if (a.status?.connected) {
            await probeAuth(a.id);
            if (a.id === activeAgentId) await refreshSessions(a.id);
          }
        }
      } catch {
        // ignore probe failures on load
      }
    });
    const t = setInterval(refreshAgents, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetThread = () => {
    setMessages([]);
    setModes(null);
    setConfigOptions(null);
    setAvailableCommands([]);
    setUsage(null);
    setSessionInfo(null);
    setPendingPerms([]);
    setPendingElic([]);
    setAttachments([]);
  };

  // Switching agent resets session-scoped state (sessions live per-agent on gateway)
  const handleSelectAgent = (id: string) => {
    if (id === activeAgentId) return;
    abortRef.current?.abort();
    setActiveAgentId(id);
    setSessionId(null);
    resetThread();
    const target = agents.find((a) => a.id === id);
    if (target?.status?.connected) refreshSessions(id);
    else setSessions([]);
  };

  const handleConnect = async (id: string = activeAgentId) => {
    setConnectingId(id);
    try {
      await connectAgent(id);
      await refreshAgents();
      await probeAuth(id);
      await refreshSessions(id);
    } catch (e: any) {
      alert(`连接 ${id} 失败: ${e.message}`);
    } finally {
      setConnectingId(null);
    }
  };

  const applyNewSessionResult = (res: any) => {
    if (res?.sessionId) {
      setSessionId(res.sessionId);
      if (res.modes) setModes(res.modes);
      if (res.configOptions) setConfigOptions(res.configOptions);
      if (res.availableCommands) setAvailableCommands(res.availableCommands);
    }
  };

  /** Create a session on demand (e.g. user tweaks model/thinking before chatting). */
  const ensureSession = async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    if (isStreaming || busy) return null;
    try {
      if (!activeAgent?.status?.connected) await connectAgent(activeAgentId);
      const res: any = await sessionNew(activeAgentId, {});
      applyNewSessionResult(res);
      setAuthOk((prev) => ({ ...prev, [activeAgentId]: true }));
      await refreshSessions();
      return res?.sessionId || null;
    } catch (e: any) {
      if (/auth/i.test(String(e?.message || ""))) {
        setAuthOk((prev) => ({ ...prev, [activeAgentId]: false }));
        setAuthOpen(true);
      } else {
        alert(`创建会话失败: ${e.message}`);
      }
      return null;
    }
  };

  /** Shared session/set_config_option with correct select/boolean shapes. */
  const setSessionConfig = async (configId: string, value: unknown) => {
    const sid = sessionId || (await ensureSession());
    if (!sid) return;
    try {
      const opt = configOptions?.find((c) => c.id === configId);
      const body: Record<string, unknown> =
        opt?.type === "boolean" || typeof value === "boolean"
          ? { sessionId: sid, configId, type: "boolean", value }
          : { sessionId: sid, configId, value };
      const res: any = await sessionRpc(activeAgentId, "set_config", body);
      if (res?.configOptions) setConfigOptions(res.configOptions);
      else if (Array.isArray(res)) setConfigOptions(res);
      else {
        // Optimistic local update when the agent returns void.
        setConfigOptions((prev) => prev?.map((c) => (c.id === configId ? { ...c, currentValue: value } : c)) || prev);
      }
    } catch (e: any) {
      alert(`set_config 失败: ${e.message}`);
    }
  };

  const handleCreateSession = async (s: SessionSettings) => {
    setBusy(true);
    try {
      if (!activeAgent?.status?.connected) await connectAgent(activeAgentId);
      const res: any = await sessionNew(activeAgentId, {
        ...(s.cwd ? { cwd: s.cwd } : {}),
        ...(s.additionalDirectories.length > 0 ? { additionalDirectories: s.additionalDirectories } : {}),
        mcpServers: s.mcpServers,
      });
      applyNewSessionResult(res);
      resetThread();
      setAuthOk((prev) => ({ ...prev, [activeAgentId]: true }));
      setSettingsOpen(false);
      await refreshAgents();
      await refreshSessions();
    } catch (e: any) {
      if (/auth/i.test(String(e?.message || ""))) {
        setAuthOk((prev) => ({ ...prev, [activeAgentId]: false }));
        setSettingsOpen(false);
        setAuthOpen(true);
      } else {
        alert(`session/new 失败: ${e.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
    setMessages((prev) => [...prev, { id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: line, timestamp: now() }]);
  };

  /** Open a session from the sidebar: load (with replay), resume, else attach bare. */
  const handleOpenSession = async (s: SessionItem) => {
    if (isStreaming) return;
    setBusy(true);
    try {
      if (!activeAgent?.status?.connected) await connectAgent(activeAgentId);
      let attached = false;
      try {
        const { result, replayed } = await loadSession(activeAgentId, {
          sessionId: s.sessionId,
          cwd: s.cwd,
          mcpServers: [],
        });
        const t = buildTranscriptFromReplay(replayed || []);
        setSessionId(s.sessionId);
        setMessages(
          t.messages.map((m, i) => ({
            id: `hist-${Date.now()}-${i}`,
            role: m.role,
            content: m.content,
            thought: m.thought,
            toolCalls: m.toolCalls,
            timestamp: now(),
          }))
        );
        if (t.plan.length > 0 && t.messages.length > 0) {
          setMessages((prev) => {
            const next = [...prev];
            const lastAsst = [...next].reverse().find((m) => m.role === "assistant");
            if (lastAsst) lastAsst.plan = t.plan;
            return next;
          });
        }
        if (t.usage) setUsage(t.usage);
        if (t.availableCommands.length > 0) setAvailableCommands(t.availableCommands);
        if (t.currentModeId) setModes((prev) => (prev ? { ...prev, currentModeId: t.currentModeId! } : prev));
        for (const a of t.activities) appendActivity(a);
        const r: any = result || {};
        if (r.modes) setModes(r.modes);
        if (r.configOptions) setConfigOptions(r.configOptions);
        setAuthOk((prev) => ({ ...prev, [activeAgentId]: true }));
        attached = true;
      } catch (loadErr: any) {
        // Fall back to resume (no replay) when load is unsupported/fails.
        try {
          await sessionRpc(activeAgentId, "resume", { sessionId: s.sessionId, cwd: s.cwd, mcpServers: [] });
          setSessionId(s.sessionId);
          resetThread();
          setMessages([{ id: `sys-${Date.now()}`, role: "system", content: `已 resume 会话（无历史回放）。`, timestamp: now() }]);
          attached = true;
        } catch {
          // Some agents (e.g. codex) reject load/resume on certain sessions
          // while session/prompt on the same id still works — attach bare so
          // the user can keep chatting instead of hitting a dead end.
          setSessionId(s.sessionId);
          resetThread();
          setMessages([{ id: `sys-${Date.now()}`, role: "system", content: `已切换到会话（该 Agent 未提供历史回放，直接继续对话即可）。`, timestamp: now() }]);
          attached = true;
        }
      }
      if (attached) await refreshSessions();
    } catch (e: any) {
      alert(`打开会话失败: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleForkSession = async (sid?: string) => {
    const source = sid || sessionId;
    if (!source || isStreaming) return;
    setBusy(true);
    try {
      const info = sessions.find((s) => s.sessionId === source);
      const res: any = await forkSession(activeAgentId, {
        sessionId: source,
        ...(info?.cwd ? { cwd: info.cwd } : {}),
      });
      applyNewSessionResult(res);
      resetThread();
      setMessages([{ id: `sys-${Date.now()}`, role: "system", content: `已从 ${source.slice(0, 8)}… fork 出新会话。`, timestamp: now() }]);
      await refreshSessions();
    } catch (e: any) {
      alert(`fork 失败: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSession = async (s: SessionItem) => {
    if (!confirm(`删除会话 ${s.title || s.sessionId}？`)) return;
    try {
      await sessionRpc(activeAgentId, "delete", { sessionId: s.sessionId });
      if (s.sessionId === sessionId) {
        setSessionId(null);
        resetThread();
      }
      await refreshSessions();
    } catch (e: any) {
      // Some agents reject delete — fall back to close (frees active resources).
      try {
        await sessionRpc(activeAgentId, "close", { sessionId: s.sessionId });
        if (s.sessionId === sessionId) {
          setSessionId(null);
          resetThread();
        }
        setMessages((prev) => [...prev, { id: `sys-${Date.now()}`, role: "system", content: `该 Agent 不支持 delete，已改用 close。`, timestamp: now() }]);
        await refreshSessions();
      } catch {
        alert(`删除失败: ${e.message}`);
      }
    }
  };

  const handleSend = async (textToSend?: string) => {
    const prompt = (textToSend ?? input).trim();
    if ((!prompt && attachments.length === 0) || isStreaming) return;
    const blocks: Record<string, unknown>[] = [
      ...attachments.map((a) => a.block),
      ...(prompt ? [{ type: "text", text: prompt }] : []),
    ];
    const display = prompt + (attachments.length > 0 ? `\n\n[附件: ${attachments.map((a) => a.name).join(", ")}]` : "");
    setInput("");
    setAttachments([]);

    const assistantId = "asst-" + Date.now();
    setMessages((prev) => [
      ...prev,
      { id: "user-" + Date.now(), role: "user", content: display, timestamp: now() },
      { id: assistantId, role: "assistant", content: "", thought: "", plan: [], toolCalls: [], timestamp: now(), isStreaming: true },
    ]);
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      if (!activeAgent?.status?.connected) await connectAgent(activeAgentId);
      await consumeUniversalChat(
        { agentId: activeAgentId, sessionId: sessionId || undefined, prompt: blocks },
        {
          onSessionId: (sid) => setSessionId(sid),
          onTextChunk: (chunk) =>
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))),
          onThoughtChunk: (chunk) =>
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, thought: (m.thought || "") + chunk } : m))),
          onToolCall: (c) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, toolCalls: [...(m.toolCalls || []), c] } : m))
            ),
          onToolCallUpdate: (c) =>
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const calls = [...(m.toolCalls || [])];
                const i = calls.findIndex((x) => x.id === c.id);
                if (i >= 0) calls[i] = { ...calls[i], ...c, title: c.title || calls[i].title };
                else calls.push(c);
                return { ...m, toolCalls: calls };
              })
            ),
          onPlan: (entries) =>
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, plan: entries } : m))),
          onAvailableCommands: (cmds) => setAvailableCommands(cmds),
          onModeUpdate: (modeId) => setModes((prev) => (prev ? { ...prev, currentModeId: modeId } : prev)),
          onConfigUpdate: (opt) =>
            setConfigOptions((prev) => {
              if (!prev) return [opt];
              const i = prev.findIndex((x) => x.id === opt.id);
              if (i >= 0) {
                const next = [...prev];
                next[i] = opt;
                return next;
              }
              return [...prev, opt];
            }),
          onSessionInfo: (info) => setSessionInfo(info),
          onUsage: (u) => {
            setUsage(u);
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, usage: u } : m)));
          },
          onActivity: (a) => appendActivity(a),
          onPermissionRequest: (p) => setPendingPerms((prev) => [...prev, p]),
          onElicitationRequest: (e) => setPendingElic((prev) => [...prev, e]),
          onDone: () => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m)));
          },
          onError: (err) => {
            if (/auth/i.test(err.message)) {
              setAuthOk((prev) => ({ ...prev, [activeAgentId]: false }));
              setAuthOpen(true);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + `\n\n> ❌ [${activeAgentId}] ${err.message}`, isStreaming: false } : m
              )
            );
          },
        },
        abortRef.current.signal
      );
      setAuthOk((prev) => ({ ...prev, [activeAgentId]: true }));
      await refreshAgents();
      await refreshSessions();
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        if (/auth/i.test(String(e?.message || ""))) {
          setAuthOk((prev) => ({ ...prev, [activeAgentId]: false }));
          setAuthOpen(true);
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + `\n\n> ❌ [连接异常] ${e.message}`, isStreaming: false } : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m)));
    }
  };

  const handleStop = async () => {
    abortRef.current?.abort();
    if (sessionId) {
      try {
        await sessionRpc(activeAgentId, "cancel", { sessionId });
      } catch {
        // ignore
      }
    }
    setIsStreaming(false);
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  };

  const handlePermRespond = async (p: PendingPermission, optionId: string | null) => {
    setRespondingId(p.permissionId);
    try {
      await respondPermission(p.agentId, p.permissionId, optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" });
      setPendingPerms((prev) => prev.filter((x) => x.permissionId !== p.permissionId));
    } catch (e: any) {
      alert(`permission respond 失败: ${e.message}`);
    } finally {
      setRespondingId(null);
    }
  };

  const handleElicRespond = async (e: PendingElicitation, accept: boolean, payload?: unknown) => {
    setRespondingId(e.elicitationId);
    try {
      const result = accept ? { action: "accept", content: payload ?? {} } : { action: "decline" };
      await respondElicitation(e.agentId, e.elicitationId, result);
      setPendingElic((prev) => prev.filter((x) => x.elicitationId !== e.elicitationId));
    } catch (err: any) {
      alert(`elicitation respond 失败: ${err.message}`);
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#070A12] text-slate-100 overflow-hidden select-text">
      <Sidebar
        agents={agents}
        activeAgentId={activeAgentId}
        onSelectAgent={handleSelectAgent}
        onConnectAgent={handleConnect}
        connectingId={connectingId}
        authOk={authOk}
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        activeSessionId={sessionId}
        onRefreshSessions={() => refreshSessions()}
        onNewSession={() => setSettingsOpen(true)}
        onOpenSession={handleOpenSession}
        onForkSession={(s) => handleForkSession(s.sessionId)}
        onDeleteSession={handleDeleteSession}
        supportsFork={supportsFork}
        supportsList={supportsList}
        onOpenProviders={() => setProvidersOpen(true)}
        supportsProviders={supportsProviders}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 border-b border-slate-800/80 bg-slate-950/80 px-5 flex items-center gap-3 shrink-0">
          <div>
            <h1 className="font-bold text-sm">ACP Studio <span className="text-indigo-400">Universal</span></h1>
            <p className="text-[10px] text-slate-500 font-mono">
              {activeAgent?.title || activeAgentId} · ACP v{activeAgent?.status?.protocolVersion ?? "?"}
              {sessionId ? ` · ${sessionId.slice(0, 13)}…` : " · 无会话"}
            </p>
          </div>
          <div className="flex-1" />
          <button onClick={() => setSettingsOpen(true)} disabled={isStreaming || busy} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-40">新会话</button>
          <button onClick={() => !isStreaming && setMessages([])} disabled={isStreaming} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-40">清空</button>
        </div>

        <AgentBar
          agents={agents}
          activeAgentId={activeAgentId}
          onSelect={handleSelectAgent}
          onConnect={() => handleConnect()}
          connecting={connectingId === activeAgentId}
          onOpenAuth={() => setAuthOpen(true)}
          onLogout={async () => {
            try {
              await logoutAgent(activeAgentId);
              await refreshAgents();
            } catch (e: any) {
              alert(`logout 失败: ${e.message}`);
            }
          }}
          authOk={authOk[activeAgentId] ?? null}
        />

        <SessionControls
          sessionId={sessionId}
          modes={modes}
          configOptions={configOptions}
          availableCommands={availableCommands}
          usage={usage}
          sessionInfo={sessionInfo}
          capabilities={activeAgent?.status?.agentCapabilities}
          onNewSession={() => setSettingsOpen(true)}
          onCloseSession={async () => {
            if (!sessionId) return;
            await sessionRpc(activeAgentId, "close", { sessionId }).catch((e: any) => alert(e.message));
            setSessionId(null);
            await refreshSessions();
          }}
          onDeleteSession={async () => {
            if (!sessionId) return;
            if (!confirm(`删除会话 ${sessionId}？`)) return;
            await sessionRpc(activeAgentId, "delete", { sessionId }).catch((e: any) => alert(e.message));
            setSessionId(null);
            resetThread();
            await refreshSessions();
          }}
          onListSessions={async () => {
            await refreshSessions();
          }}
          onSetMode={async (modeId) => {
            if (!sessionId) return;
            try {
              await sessionRpc(activeAgentId, "set_mode", { sessionId, modeId });
              setModes((prev) => (prev ? { ...prev, currentModeId: modeId } : prev));
            } catch (e: any) {
              alert(`set_mode 失败: ${e.message}`);
            }
          }}
          onSetConfig={(configId, value) => setSessionConfig(configId, value)}
          onInsertCommand={(cmd) => setInput((prev) => (prev ? prev + " " + cmd : cmd))}
          onForkSession={() => handleForkSession()}
          onOpenProviders={() => setProvidersOpen(true)}
          supportsFork={supportsFork}
          supportsProviders={supportsProviders}
          busy={busy || isStreaming}
        />

        <PermissionDialog pending={pendingPerms.filter((p) => !sessionId || p.sessionId === sessionId)} onRespond={handlePermRespond} respondingId={respondingId} />

        {pendingElic.length > 0 && (
          <div className="px-4 pt-2 space-y-2 max-h-64 overflow-y-auto shrink-0">
            {pendingElic.map((e) => (
              <ElicitationCard key={e.elicitationId} e={e} onRespond={handleElicRespond} busy={respondingId === e.elicitationId} />
            ))}
          </div>
        )}

        <ChatArea
          messages={messages}
          isStreaming={isStreaming}
          selectedModel={activeAgent?.title || activeAgentId}
          selectedMode={modes?.currentModeId || ""}
          onSelectSuggestion={(p) => handleSend(p)}
          agentName={activeAgent?.title || activeAgent?.name || "Agent"}
        />

        <UniversalComposer
          input={input}
          setInput={setInput}
          onSend={(t) => handleSend(t)}
          onStop={handleStop}
          onClear={() => !isStreaming && setMessages([])}
          isStreaming={isStreaming}
          commands={availableCommands}
          supportImage={supportImage}
          attachments={attachments}
          setAttachments={setAttachments}
          agentTitle={activeAgent?.title || activeAgentId}
          configOptions={configOptions}
          onSetConfig={(configId, value) => setSessionConfig(configId, value)}
        />
      </div>

      <UniversalAuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        agent={activeAgent}
        onAuthenticated={async () => {
          await refreshAgents();
          await probeAuth(activeAgentId);
        }}
        onLogout={async () => {
          try {
            await logoutAgent(activeAgentId);
            await refreshAgents();
          } catch (e: any) {
            alert(`logout 失败: ${e.message}`);
          }
        }}
        authOk={authOk[activeAgentId] ?? null}
      />

      <SessionSettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onCreate={handleCreateSession}
        busy={busy}
        supportsAdditionalDirs={supportsAdditionalDirs}
        supportsMcpHttp={!!mcpCaps.http}
      />

      <ProvidersModal isOpen={providersOpen} onClose={() => setProvidersOpen(false)} agentId={activeAgentId} />
    </div>
  );
}
