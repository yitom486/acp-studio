import React, { useState, useEffect, useRef } from "react";
import { ChatArea, Message } from "./components/ChatArea";
import { ChatInput } from "./components/ChatInput";
import { AgentBar } from "./components/universal/AgentBar";
import { SessionControls } from "./components/universal/SessionControls";
import { PermissionDialog } from "./components/universal/PermissionDialog";
import { UniversalAuthModal } from "./components/universal/AuthModal";
import {
  fetchAgents,
  connectAgent,
  logoutAgent,
  sessionNew,
  sessionRpc,
  respondPermission,
  respondElicitation,
  consumeUniversalChat,
  type AgentSummary,
  type PendingPermission,
  type PendingElicitation,
} from "./lib/universal-api";

/**
 * ACP Studio Universal (v1 complete).
 * Generic stdio gateway client: codex / gemini / claude / opencode / antigravity-stdio ...
 */
export default function App() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>("codex");
  const [connecting, setConnecting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [modes, setModes] = useState<{ currentModeId?: string; availableModes?: Array<{ id: string; name?: string }> } | null>(null);
  const [configOptions, setConfigOptions] = useState<any[] | null>(null);
  const [availableCommands, setAvailableCommands] = useState<Array<{ name: string; description?: string }>>([]);
  const [usage, setUsage] = useState<{ used: number; size: number; cost?: { amount: number; currency: string } } | null>(null);
  const [sessionInfo, setSessionInfo] = useState<any>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingPerms, setPendingPerms] = useState<PendingPermission[]>([]);
  const [pendingElic, setPendingElic] = useState<PendingElicitation[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [sessionsModal, setSessionsModal] = useState<{ open: boolean; items: any[] }>({ open: false, items: [] });
  const [busy, setBusy] = useState(false);
  /** Per-agent local-auth probe: true = session/list passed without authenticate. */
  const [authOk, setAuthOk] = useState<Record<string, boolean | null>>({});

  const abortRef = useRef<AbortController | null>(null);
  const activeAgent = agents.find((a) => a.id === activeAgentId);

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

  useEffect(() => {
    refreshAgents().then(async () => {
      // Probe local-auth reuse for agents that are already connected
      // (e.g. gateway kept the codex process across page reloads).
      try {
        const list = await fetchAgents();
        for (const a of list) {
          if (a.status?.connected) await probeAuth(a.id);
        }
      } catch {
        // ignore probe failures on load
      }
    });
    const t = setInterval(refreshAgents, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching agent resets session-scoped state (sessions live per-agent on gateway)
  const handleSelectAgent = (id: string) => {
    if (id === activeAgentId) return;
    abortRef.current?.abort();
    setActiveAgentId(id);
    setSessionId(null);
    setModes(null);
    setConfigOptions(null);
    setAvailableCommands([]);
    setUsage(null);
    setSessionInfo(null);
    setMessages([]);
    setPendingPerms([]);
    setPendingElic([]);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connectAgent(activeAgentId);
      await refreshAgents();
      await probeAuth(activeAgentId);
    } catch (e: any) {
      alert(`连接 ${activeAgentId} 失败: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleNewSession = async () => {
    if (isStreaming) return;
    setBusy(true);
    try {
      if (!activeAgent?.status?.connected) await connectAgent(activeAgentId);
      const res: any = await sessionNew(activeAgentId, {});
      if (res?.sessionId) {
        setSessionId(res.sessionId);
        if (res.modes) setModes(res.modes);
        if (res.configOptions) setConfigOptions(res.configOptions);
        if (res.availableCommands) setAvailableCommands(res.availableCommands);
      }
      setMessages([]);
      setUsage(null);
      setSessionInfo(null);
      setAuthOk((prev) => ({ ...prev, [activeAgentId]: true }));
      await refreshAgents();
    } catch (e: any) {
      if (/auth/i.test(String(e?.message || ""))) {
        setAuthOk((prev) => ({ ...prev, [activeAgentId]: false }));
        setAuthOpen(true);
      }
      alert(`session/new 失败: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async (textToSend?: string) => {
    const prompt = (textToSend ?? input).trim();
    if (!prompt || isStreaming) return;
    setInput("");
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const assistantId = "asst-" + Date.now();
    setMessages((prev) => [
      ...prev,
      { id: "user-" + Date.now(), role: "user", content: prompt, timestamp: now },
      { id: assistantId, role: "assistant", content: "", thought: "", plan: [], toolCalls: [], timestamp: now, isStreaming: true },
    ]);
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      if (!activeAgent?.status?.connected) await connectAgent(activeAgentId);
      await consumeUniversalChat(
        { agentId: activeAgentId, sessionId: sessionId || undefined, prompt },
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
          onPermissionRequest: (p) => setPendingPerms((prev) => [...prev, p]),
          onElicitationRequest: (e) => setPendingElic((prev) => [...prev, e]),
          onDone: () => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m)));
          },
          onError: (err) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + `\n\n> ❌ [${activeAgentId}] ${err.message}`, isStreaming: false } : m
              )
            ),
        },
        abortRef.current.signal
      );
      await refreshAgents();
    } catch (e: any) {
      if (e?.name !== "AbortError") {
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
      // ACP elicitation response: {action:"accept",content} | {action:"decline"} | {action:"cancel"}
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
    <div className="flex flex-col h-screen w-screen bg-[#070A12] text-slate-100 overflow-hidden select-text">
      <div className="h-16 border-b border-slate-800/80 bg-slate-950/80 px-6 flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center font-extrabold">A</div>
        <div>
          <h1 className="font-bold">ACP Studio <span className="text-indigo-400">Universal</span></h1>
          <p className="text-[11px] text-slate-400 font-mono">ACP v1 · codex / gemini / claude / opencode / antigravity-stdio</p>
        </div>
        <div className="flex-1" />
        <button onClick={handleNewSession} disabled={isStreaming || busy} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-40">新会话</button>
        <button onClick={() => setMessages([])} disabled={isStreaming} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-40">清空</button>
      </div>

      <AgentBar
        agents={agents}
        activeAgentId={activeAgentId}
        onSelect={handleSelectAgent}
        onConnect={handleConnect}
        connecting={connecting}
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
        onNewSession={handleNewSession}
        onCloseSession={async () => {
          if (!sessionId) return;
          await sessionRpc(activeAgentId, "close", { sessionId }).catch((e: any) => alert(e.message));
          setSessionId(null);
        }}
        onDeleteSession={async () => {
          if (!sessionId) return;
          if (!confirm(`删除会话 ${sessionId}？`)) return;
          await sessionRpc(activeAgentId, "delete", { sessionId }).catch((e: any) => alert(e.message));
          setSessionId(null);
          setMessages([]);
        }}
        onListSessions={async () => {
          try {
            const res: any = await sessionRpc(activeAgentId, "list", {});
            const items = res?.sessions || res || [];
            setSessionsModal({ open: true, items: Array.isArray(items) ? items : [] });
          } catch (e: any) {
            alert(`session/list 失败（该 Agent 可能不支持）: ${e.message}`);
          }
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
        onSetConfig={async (configId, value) => {
          if (!sessionId) return;
          try {
            const res: any = await sessionRpc(activeAgentId, "set_config", { sessionId, configId, value });
            if (res?.configOptions) setConfigOptions(res.configOptions);
            else if (Array.isArray(res)) setConfigOptions(res);
          } catch (e: any) {
            alert(`set_config 失败: ${e.message}`);
          }
        }}
        onInsertCommand={(cmd) => setInput((prev) => (prev ? prev + " " + cmd : cmd))}
        busy={busy || isStreaming}
      />

      <PermissionDialog pending={pendingPerms.filter((p) => !sessionId || p.sessionId === sessionId)} onRespond={handlePermRespond} respondingId={respondingId} />

      {pendingElic.length > 0 && (
        <div className="px-4 pt-2 space-y-2">
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
      />

      <ChatInput
        input={input}
        setInput={setInput}
        onSend={() => handleSend()}
        onStop={handleStop}
        onClear={() => !isStreaming && setMessages([])}
        isStreaming={isStreaming}
        selectedModel={activeAgent?.title || activeAgentId}
        selectedMode={modes?.currentModeId || ""}
      />

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

      {sessionsModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setSessionsModal({ open: false, items: [] })}>
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-4 text-xs" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold mb-2">Sessions ({sessionsModal.items.length})</div>
            <div className="max-h-80 overflow-y-auto space-y-1.5">
              {sessionsModal.items.map((s: any, i: number) => {
                const sid = s.sessionId || s.id || JSON.stringify(s).slice(0, 40);
                return (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg border border-slate-800">
                    <span className="font-mono truncate flex-1">{s.title ? `${s.title} · ` : ""}{sid}</span>
                    <button
                      className="px-2 py-1 rounded border border-slate-600 hover:border-indigo-500"
                      onClick={async () => {
                        try {
                          await sessionRpc(activeAgentId, "resume", { sessionId: s.sessionId || s.id, cwd: undefined, mcpServers: [] });
                          setSessionId(s.sessionId || s.id);
                          setSessionsModal({ open: false, items: [] });
                        } catch (err: any) {
                          try {
                            await sessionRpc(activeAgentId, "load", { sessionId: s.sessionId || s.id, cwd: undefined, mcpServers: [] });
                            setSessionId(s.sessionId || s.id);
                            setSessionsModal({ open: false, items: [] });
                          } catch (e2: any) {
                            alert(`resume/load 失败: ${e2.message}`);
                          }
                        }
                      }}
                    >
                      打开
                    </button>
                  </div>
                );
              })}
              {sessionsModal.items.length === 0 && <div className="text-slate-500">无会话或该 Agent 不支持 list。</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ElicitationCard({ e, onRespond, busy }: { e: PendingElicitation; onRespond: (e: PendingElicitation, accept: boolean, payload?: unknown) => void; busy: boolean }) {
  const [text, setText] = React.useState("");
  return (
    <div className="rounded-xl border border-sky-500/40 bg-sky-950/30 p-3 text-xs space-y-2">
      <div className="font-semibold text-sky-300">需要输入 · {e.message}</div>
      <details className="text-slate-400">
        <summary className="cursor-pointer">schema 详情</summary>
        <pre className="font-mono text-[10px] whitespace-pre-wrap max-h-32 overflow-y-auto">{JSON.stringify(e.schema, null, 2).slice(0, 2000)}</pre>
      </details>
      <textarea
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        placeholder='accept 时提交的 JSON content（可空 {}）'
        rows={2}
        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 font-mono text-[11px] outline-none"
      />
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => {
            let payload: unknown = {};
            if (text.trim()) {
              try {
                payload = JSON.parse(text);
              } catch {
                alert("不是合法 JSON");
                return;
              }
            }
            onRespond(e, true, payload);
          }}
          className="px-2.5 py-1 rounded-lg bg-sky-600 text-white disabled:opacity-50"
        >
          提交
        </button>
        <button disabled={busy} onClick={() => onRespond(e, false)} className="px-2.5 py-1 rounded-lg border border-slate-600">
          拒绝
        </button>
      </div>
    </div>
  );
}
