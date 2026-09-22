import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChatArea } from "@/components/ChatArea";
import { StudioHeader } from "@/components/universal/StudioHeader";
import { Sidebar, type SessionItem } from "@/components/universal/Sidebar";
import { SessionSettingsModal, type SessionSettings } from "@/components/universal/SessionSettingsModal";
import { ProvidersModal } from "@/components/universal/ProvidersModal";
import { PermissionDialog } from "@/components/universal/PermissionDialog";
import { ElicitationCard } from "@/components/universal/ElicitationCard";
import { UniversalAuthModal } from "@/components/universal/AuthModal";
import { UniversalComposer } from "@/components/universal/UniversalComposer";
import { CustomAgentModal } from "@/components/universal/CustomAgentModal";
import { GitChangesModal } from "@/components/universal/GitChangesModal";
import { TerminalDrawer } from "@/components/universal/TerminalDrawer";
import { ModelBrowserModal } from "@/components/universal/ModelBrowserModal";
import { useStudioStore } from "@/stores/useStudioStore";
import { useAgentsQuery, useSessionsQuery, invalidateAgents, invalidateSessions } from "@/lib/acp-queries";
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
  flattenConfigOptions,
  parseModelId,
  isAuthRequiredError,
  getWorkspaceDefault,
  validateWorkspace,
  agentInstallState,
  installAgent,
  getBridgeSource,
  setBridgeSource,
  type PendingPermission,
  type PendingElicitation,
  type ActivityEvent,
  type InstallState,
} from "@/lib/universal-api";

/**
 * ACP Studio Universal — full ACP v1 client.
 * State: zustand (client) + TanStack Query (server). See
 * .agents/rules/state_management.md for the conventions.
 */
export default function App() {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const ensuredRef = useRef<string | null>(null);
  const installStatesRef = useRef<Record<string, boolean>>({});
  const [customOpen, setCustomOpen] = useState(false);
  const s = useStudioStore();

  // Managed-install state per agent (on-demand runtimes, see
  // .agents/rules/no-silent-fallbacks.md). Local state on purpose: it is
  // derived UI chrome, not server truth.
  const [installStates, setInstallStates] = useState<Record<string, InstallState | null>>({});
  const [installingId, setInstallingId] = useState<string | null>(null);
  // Bridge source switch: dev UI only (import.meta.env.DEV is false in the
  // packaged app, so the toggle can never appear in production).
  const [bridgeSource, setBridgeSourceState] = useState<{ source: "npm" | "local" } | null>(null);
  const [switchingSource, setSwitchingSource] = useState(false);

  const refreshBridgeSource = async () => {
    if (!import.meta.env.DEV) return;
    try {
      const st = await getBridgeSource();
      setBridgeSourceState({ source: st.source });
    } catch {
      // gateway without the endpoint (old server): hide the toggle
      setBridgeSourceState(null);
    }
  };

  const handleBridgeSource = async (source: "npm" | "local") => {
    setSwitchingSource(true);
    try {
      const st = await setBridgeSource(source);
      setBridgeSourceState({ source: st.source });
      invalidateAgents(qc);
      alert(`桥来源已切换为 ${st.source === "npm" ? "npm 按需版" : "本地开发版"}，下次连接生效。`);
    } catch (e: any) {
      alert(`切换失败: ${e?.message || e}`);
    } finally {
      setSwitchingSource(false);
    }
  };

  const refreshInstallState = async (id: string) => {
    const st = await agentInstallState(id);
    if (st) setInstallStates((prev) => ({ ...prev, [id]: st }));
  };

  const handleInstall = async (id: string) => {
    setInstallingId(id);
    try {
      const res = await installAgent(id);
      alert(`安装成功${res.version ? `（v${res.version}）` : ""}，正在连接…`);
      await refreshInstallState(id);
      invalidateAgents(qc);
      await handleConnect(id);
    } catch (e: any) {
      alert(`安装失败: ${e?.message || e}`);
    } finally {
      setInstallingId(null);
    }
  };

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

  // Boot: instant-render the agent's last thread from local cache (layer 1:
  // zero network; Inkdown-style zustand/persist equivalent).
  useEffect(() => {
    const st = useStudioStore.getState();
    if (!st.restoreThread(st.activeAgentId)) st.newThread(st.activeAgentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the live view (trailing throttle): crash/reload-safe threads.
  useEffect(() => {
    const t = setTimeout(() => {
      const st = useStudioStore.getState();
      if (st.activeThreadId) st.snapshotThread();
    }, 1500);
    return () => clearTimeout(t);
  }, [s.messages, s.sessionId, s.activeAgentId, s.activeThreadId]);

  // Fetch managed-install states once per agent id (missing/error -> null,
  // silently: only managed agents report).
  useEffect(() => {
    for (const a of agents) {
      if (!(a.id in installStatesRef.current)) {
        installStatesRef.current[a.id] = true;
        void refreshInstallState(a.id);
      }
    }
    void refreshBridgeSource();
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

  const effectiveCwd = s.currentWorkspace || sessionCwd;

  // Initialize default workspace from server if empty
  useEffect(() => {
    if (!s.currentWorkspace) {
      getWorkspaceDefault()
        .then((res) => {
          if (res?.path && !useStudioStore.getState().currentWorkspace) {
            useStudioStore.getState().setWorkspace(res.path, res.name);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Global shortcuts (Ctrl+`, Ctrl+Shift+D, Ctrl+O)
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Toggle Terminal: Ctrl + `
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        const cur = useStudioStore.getState();
        cur.setTerminalOpen(!cur.terminalOpen);
        return;
      }
      // Toggle Git diff: Ctrl + Shift + D
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        const cur = useStudioStore.getState();
        cur.setGitChangesOpen(!cur.gitChangesOpen);
        return;
      }
      // Open Directory: Ctrl + O
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        if (window.acpStudio?.openDirectory) {
          try {
            const dir = await window.acpStudio.openDirectory();
            if (dir) {
              useStudioStore.getState().setWorkspace(dir);
            }
          } catch (err: any) {
            console.error("Open directory error:", err);
          }
        } else {
          const input = prompt("请输入本地项目工作区绝对路径:", useStudioStore.getState().currentWorkspace || "");
          if (input && input.trim()) {
            const res = await validateWorkspace(input.trim());
            if (res.ok && res.path) {
              useStudioStore.getState().setWorkspace(res.path, res.name);
            } else {
              alert("无效目录: " + (res.error || "路径不存在"));
            }
          }
        }
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      const reqCwd = st.currentWorkspace || undefined;
      const res: any = await sessionNew(agentId, { ...(reqCwd ? { cwd: reqCwd } : {}) });
      st.applySessionResult(res);
      st.bindThreadSession(useStudioStore.getState().sessionId, reqCwd);
      st.setAuthOk(agentId, true);
      invalidateSessions(qc, agentId);
      invalidateAgents(qc);
      if (res?.sessionId) {
        void applyDefaultConfigOptions(agentId, res.sessionId);
      }
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
    st.snapshotThread();
    st.setActiveAgentId(id);
    // Per-agent isolation: only this agent's own thread (and its sessionId)
    // ever enters the live view.
    if (!st.restoreThread(id)) st.newThread(id);
    const target = agents.find((a) => a.id === id);
    if (target?.status?.connected) {
      invalidateSessions(qc, id);
      ensuredRef.current = id;
      void ensureSession(id, true);
    }
  };

  /**
   * True resume (Inkdown-style layer 2): reattach the remembered ACP session
   * so model-side context continues. Displayed messages already come from the
   * persisted thread cache, so no history replay is requested here (avoids
   * duplicate bubbles). Returns true when the old session lives on.
   */
  const restoreAgentSession = async (agentId: string): Promise<boolean> => {
    const st = useStudioStore.getState();
    const sid = st.sessionId;
    if (!sid || st.isStreaming) return false;
    // Isolation: resume only ids bound to THIS agent's live thread.
    const thread = st.activeThreadId ? st.threads[st.activeThreadId] : undefined;
    if (!thread || thread.agentId !== agentId || thread.sessionId !== sid) return false;
    try {
      await sessionRpc(agentId, "resume", {
        sessionId: sid,
        ...(thread.cwd || st.currentWorkspace ? { cwd: thread.cwd || st.currentWorkspace } : {}),
        mcpServers: [],
      });
      return true;
    } catch {
      // Visible degrade (no silent fallback): keep cached messages on screen,
      // mark stale, drop the dead binding so the next prompt news a session.
      st.markThreadStale();
      st.bindThreadSession(null);
      st.appendMessage({
        id: `sys-${Date.now()}-stale`,
        role: "system",
        content: `上次会话 (${sid.slice(0, 8)}…) 已失效（agent 重启或会话被清理），将自动新建会话续聊，历史消息保留在上方。`,
        timestamp: now(),
      });
      return false;
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
      // Reattach the remembered session first; only news one when needed.
      const resumed = await restoreAgentSession(id);
      if (!resumed) {
        // Auto-create or ensure an active session so model/thinking/permission selectors
        // (which come from session configOptions) show up immediately.
        ensuredRef.current = id;
        await ensureSession(id, true);
      } else {
        ensuredRef.current = id;
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
      const reqCwd = settings.cwd || st.currentWorkspace || undefined;
      const res: any = await sessionNew(agentId, {
        ...(reqCwd ? { cwd: reqCwd } : {}),
        ...(settings.additionalDirectories.length > 0 ? { additionalDirectories: settings.additionalDirectories } : {}),
        mcpServers: settings.mcpServers,
      });
      // 先开新线程，再应用新会话的 modes/models/config
      st.newThread(agentId);
      st.applySessionResult(res);
      st.bindThreadSession(useStudioStore.getState().sessionId, reqCwd);
      st.setAuthOk(agentId, true);
      st.setSettingsOpen(false);
      invalidateAgents(qc);
      invalidateSessions(qc, agentId);
      if (res?.sessionId) {
        void applyDefaultConfigOptions(agentId, res.sessionId);
      }
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

  /** Auto-apply saved / default config options (zustand per-agent prefs, 兼容旧 key) */
  const applyDefaultConfigOptions = async (agentId: string, sessionId: string) => {
    try {
      // 一次性迁移旧 key: acp_default_config_<agentId> -> zustand agentPrefs
      try {
        const legacyRaw = localStorage.getItem(`acp_default_config_${agentId}`);
        if (legacyRaw) {
          const legacy = JSON.parse(legacyRaw);
          if (legacy && typeof legacy === "object") {
            useStudioStore.getState().saveAgentPref(agentId, { configValues: legacy });
          }
          localStorage.removeItem(`acp_default_config_${agentId}`);
        }
      } catch {
        // ignore migration errors
      }
      const pref = useStudioStore.getState().agentPrefs?.[agentId];
      const saved = pref?.configValues;
      if (!saved || typeof saved !== "object" || Object.keys(saved).length === 0) {
        // 无记忆时快照当前默认值，方便下次恢复
        try {
          const cur0 = useStudioStore.getState();
          const snap: Record<string, unknown> = {};
          for (const o of cur0.configOptions || []) {
            if (o?.id == null) continue;
            snap[o.id] = (o.currentValue as any)?.value ?? o.currentValue;
          }
          if (Object.keys(snap).length > 0) cur0.saveAgentPref(agentId, { configValues: snap });
          if (cur0.models?.currentModelId) cur0.saveAgentPref(agentId, { fallbackModelId: cur0.models.currentModelId });
          if (cur0.modes?.currentModeId) cur0.saveAgentPref(agentId, { modeId: cur0.modes.currentModeId });
        } catch {
          // ignore
        }
        return;
      }
      // First apply model if saved, so dynamic options (like effort/thinking) unlock in agent response
      const modelOptId =
        useStudioStore.getState().configOptions?.find((c) => c.id === "model")?.id || (saved.model !== undefined ? "model" : undefined);
      if (modelOptId && (saved as any).model !== undefined) {
        const opt = useStudioStore.getState().configOptions?.find((c) => c.id === modelOptId);
        const v = (saved as any).model;
        const flat = flattenConfigOptions(opt?.options);
        if (flat.length === 0 || flat.some((o) => o.value === String((v as any)?.value ?? v))) {
          const body = { sessionId, configId: modelOptId, value: (v as any)?.value ?? v };
          const res: any = await sessionRpc(agentId, "set_config", body).catch(() => null);
          if (res?.configOptions) useStudioStore.getState().setConfigOptions(res.configOptions);
          else if (Array.isArray(res)) useStudioStore.getState().setConfigOptions(res);
          else if (res) useStudioStore.getState().patchConfigOption({ ...(opt || { id: modelOptId }), currentValue: (v as any)?.value ?? v });
        }
      }
      // Then apply other options (e.g. effort, reasoning_effort, mode)
      for (const [k, v] of Object.entries(saved)) {
        if (k === "model") continue;
        const opt = useStudioStore.getState().configOptions?.find((c) => c.id === k);
        if (!opt) continue;
        const flat = flattenConfigOptions(opt.options);
        const vv = (v as any)?.value ?? v;
        if (flat.length > 0 && !flat.some((o) => o.value === String(vv))) continue;
        const curV = (opt.currentValue as any)?.value ?? opt.currentValue;
        const wantV = (v as any)?.value ?? v;
        if (String(curV ?? "") === String(wantV ?? "")) continue;
        const body =
          opt?.type === "boolean" || typeof wantV === "boolean"
            ? { sessionId, configId: k, type: "boolean", value: wantV }
            : { sessionId, configId: k, value: wantV };
        const res: any = await sessionRpc(agentId, "set_config", body).catch(() => null);
        if (res?.configOptions) useStudioStore.getState().setConfigOptions(res.configOptions);
        else if (Array.isArray(res)) useStudioStore.getState().setConfigOptions(res);
        else if (res) useStudioStore.getState().patchConfigOption({ ...(opt || { id: k }), currentValue: wantV });
      }
      // Restore fallback model highlight + mode (best-effort, ignore failures)
      try {
        const stAfter = useStudioStore.getState();
        if (pref?.fallbackModelId && stAfter.models && stAfter.models.currentModelId !== pref.fallbackModelId) {
          const listed = (stAfter.models.availableModels || []).some((m) => m.modelId === pref.fallbackModelId);
          if (listed) stAfter.setModels({ ...stAfter.models, currentModelId: pref.fallbackModelId });
        }
        if (pref?.modeId && stAfter.modes && stAfter.modes.currentModeId !== pref.modeId) {
          const avail = stAfter.modes.availableModes || [];
          if (avail.some((m) => m.id === pref.modeId)) {
            await sessionRpc(agentId, "set_mode", { sessionId, modeId: pref.modeId }).catch(() => null);
            const sNow = useStudioStore.getState();
            if (sNow.modes) sNow.setModes({ ...sNow.modes, currentModeId: pref.modeId });
          }
        }
      } catch {
        // ignore
      }
    } catch {
      // ignore
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

      // Persist user preference for this agent (zustand per-agent prefs + localStorage)
      useStudioStore.getState().rememberAgentConfig(st.activeAgentId, configId, value);
    } catch (e: any) {
      alert(`set_config 失败: ${e.message}`);
    }
  };

  const appendActivity = (a: ActivityEvent) => {
    // Internal metadata / control events should never be dumped as raw chat messages
    if (!a?.kind || a.kind === "session_info_update" || a.kind.endsWith("_update") || a.kind === "plan") return;
    const icon =
      a.kind === "fs_read" ? "📖" : a.kind === "fs_write" ? "📝" : a.kind.startsWith("terminal") ? "▶️" : a.kind.startsWith("compaction") ? "🗜️" : a.kind.startsWith("plan") ? "📋" : "🔧";
    let summary = "";
    try {
      const d: any = a.detail || {};
      summary = d.path || d.command || d.terminalId || d.status || (typeof d === "string" ? d : "");
    } catch {
      summary = "";
    }
    if (!summary) return;
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
        const workspaceCwd = useStudioStore.getState().currentWorkspace || "";
        const effectiveCwd = item.cwd || workspaceCwd;
        const { result, replayed } = await loadSession(agentId, {
          sessionId: item.sessionId,
          cwd: effectiveCwd,
          mcpServers: [],
        });
        const t = buildTranscriptFromReplay(replayed || []);
        const cur = useStudioStore.getState();
        cur.setSessionId(item.sessionId);
        cur.bindThreadSession(item.sessionId, effectiveCwd || null);
        if (t.sessionTitle || t.sessionGoal !== undefined) {
          cur.setSessionInfo({
            ...(cur.sessionInfo || {}),
            title: t.sessionTitle || item.title || cur.sessionInfo?.title,
            goal: t.sessionGoal !== undefined ? t.sessionGoal : cur.sessionInfo?.goal,
          });
        }
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
        // 打开历史会话：把该会话的当前配置记为该 agent 的上次配置
        try {
          const sSnap = useStudioStore.getState();
          const cfg: Record<string, unknown> = {};
          for (const o of sSnap.configOptions || []) {
            if (o?.id == null) continue;
            cfg[o.id] = (o.currentValue as any)?.value ?? o.currentValue;
          }
          sSnap.saveAgentPref(agentId, {
            ...(Object.keys(cfg).length > 0 ? { configValues: cfg } : {}),
            ...(sSnap.models?.currentModelId ? { fallbackModelId: sSnap.models.currentModelId } : {}),
            ...(sSnap.modes?.currentModeId ? { modeId: sSnap.modes.currentModeId } : {}),
          });
        } catch {
          // ignore
        }
      } catch {
        // Fall back to resume (no replay) when load is unsupported/fails.
        const workspaceCwd = useStudioStore.getState().currentWorkspace || "";
        const effectiveCwd = item.cwd || workspaceCwd;
        try {
          const resumeRes: any = await sessionRpc(agentId, "resume", { sessionId: item.sessionId, cwd: effectiveCwd, mcpServers: [] });
          const cur = useStudioStore.getState();
          cur.setSessionId(item.sessionId);
          cur.bindThreadSession(item.sessionId, effectiveCwd || null);
          if (resumeRes?.modes) cur.setModes(resumeRes.modes);
          if (resumeRes?.models) cur.setModels(resumeRes.models);
          if (resumeRes?.configOptions) cur.setConfigOptions(resumeRes.configOptions);
          cur.setMessages([{ id: `sys-${Date.now()}`, role: "system", content: `已 resume 会话（无历史回放）。`, timestamp: now() }]);
        } catch {
          // Some agents reject load/resume while session/prompt on the same
          // id still works — attach bare instead of hitting a dead end.
          const cur = useStudioStore.getState();
          cur.setSessionId(item.sessionId);
          cur.bindThreadSession(item.sessionId, effectiveCwd || null);
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
      cur.newThread(agentId);
      cur.applySessionResult(res);
      cur.bindThreadSession(useStudioStore.getState().sessionId, info?.cwd || null);
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
        cur.bindThreadSession(null);
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
          cur.bindThreadSession(null);
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
      useStudioStore.getState().saveAgentPref(st.activeAgentId, { fallbackModelId: modelId });
      return;
    }
    const sid = st.sessionId || (await ensureSession());
    if (!sid) return;
    try {
      // Legacy agy-style servers implement session/set_model directly.
      await sessionRpc(st.activeAgentId, "set_model", { sessionId: sid, modelId });
      const cur = useStudioStore.getState();
      if (cur.models) cur.setModels({ ...cur.models, currentModelId: modelId });
      cur.saveAgentPref(st.activeAgentId, { fallbackModelId: modelId });
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
      const flat = flattenConfigOptions(thinkOpt?.options);
      if (thinkOpt && flat.some((o) => o.value.toLowerCase() === effort.toLowerCase())) {
        await setSessionConfig(thinkOpt.id, effort);
      }
    }
    const cur2 = useStudioStore.getState();
    if (cur2.models) cur2.setModels({ ...cur2.models, currentModelId: modelId });
    cur2.saveAgentPref(st.activeAgentId, { fallbackModelId: modelId });
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
            const stNow = useStudioStore.getState();
            if (stNow.modes) stNow.setModes({ ...stNow.modes, currentModeId: modeId });
            useStudioStore.getState().saveAgentPref(agentId, { modeId });
          },
          onConfigUpdate: (opt) => {
            const stNow = useStudioStore.getState();
            stNow.patchConfigOption(opt);
            if (opt?.id) {
              stNow.rememberAgentConfig(agentId, opt.id, (opt.currentValue as any)?.value ?? opt.currentValue);
            }
          },
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
        installStates={installStates}
        installingId={installingId}
        onInstallAgent={handleInstall}
        bridgeSource={bridgeSource}
        switchingSource={switchingSource}
        onBridgeSource={handleBridgeSource}
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
        <StudioHeader
          agents={agents}
          activeAgentId={s.activeAgentId}
          onSelectAgent={handleSelectAgent}
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
          sessionId={s.sessionId}
          sessionTitle={s.sessionInfo?.title}
          usage={s.usage}
          currentWorkspace={s.currentWorkspace}
          recentWorkspaces={s.recentWorkspaces}
          onSelectWorkspace={(p, name) => s.setWorkspace(p, name)}
          terminalOpen={s.terminalOpen}
          onToggleTerminal={() => s.setTerminalOpen(!s.terminalOpen)}
          hasChangesCwd={!!effectiveCwd}
          supportsFork={supportsFork}
          supportsProviders={supportsProviders}
          busy={s.busy || s.isStreaming}
          isStreaming={s.isStreaming}
          onNewSession={() => s.setSettingsOpen(true)}
          onForkSession={() => handleForkSession()}
          onOpenProviders={() => s.setProvidersOpen(true)}
          onOpenChanges={() => s.setGitChangesOpen(true)}
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
          onClearMessages={() => !s.isStreaming && s.setMessages([])}
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
          onOpenDiff={(file) => s.setGitChangesOpen(true, file)}
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
        defaultCwdHint={effectiveCwd || undefined}
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
        isOpen={s.gitChangesOpen}
        onClose={() => s.setGitChangesOpen(false)}
        cwd={effectiveCwd}
        initialFilePath={s.gitDiffFile}
      />

      <TerminalDrawer
        isOpen={s.terminalOpen}
        onClose={() => s.setTerminalOpen(false)}
        cwd={effectiveCwd}
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
