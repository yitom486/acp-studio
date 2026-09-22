import { create } from "zustand";
import type { Message } from "@/components/ChatArea";
import type {
  Attachment,
  ModelCatalog,
  PendingElicitation,
  PendingPermission,
} from "@/lib/universal-api";

export interface ModeState {
  currentModeId?: string;
  availableModes?: Array<{ id: string; name?: string }>;
}

export interface UsageState {
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
}

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpened: number;
}

export interface AgentPrefs {
  /** configId -> value (model / thinking / permission / 其他透传项) */
  configValues?: Record<string, unknown>;
  /** 无 model config 时的 fallback: models.currentModelId / catalog modelId */
  fallbackModelId?: string;
  /** modes.currentModeId */
  modeId?: string;
  updatedAt: number;
}

interface StudioState {
  // connection (client)
  activeAgentId: string;
  connectingId: string | null;
  authOk: Record<string, boolean | null>;
  // session (client view of server state)
  sessionId: string | null;
  modes: ModeState | null;
  models: ModelCatalog | null;
  configOptions: any[] | null;
  availableCommands: Array<{ name: string; description?: string }>;
  usage: UsageState | null;
  sessionInfo: any;
  // thread
  messages: Message[];
  // composer
  input: string;
  attachments: Attachment[];
  isStreaming: boolean;
  busy: boolean;
  discovering: boolean;
  // overlays
  authOpen: boolean;
  settingsOpen: boolean;
  providersOpen: boolean;
  modelsOpen: boolean;
  // pending agent requests
  pendingPerms: PendingPermission[];
  pendingElic: PendingElicitation[];
  respondingId: string | null;

  // workspace & desktop tools
  currentWorkspace: string | null;
  recentWorkspaces: RecentWorkspace[];
  terminalOpen: boolean;
  gitChangesOpen: boolean;
  gitDiffFile: string | null;

  // per-agent last-used model/config memory (persisted to localStorage)
  agentPrefs: Record<string, AgentPrefs>;

  // actions
  setWorkspace: (path: string, name?: string) => void;
  setTerminalOpen: (v: boolean) => void;
  setGitChangesOpen: (v: boolean, file?: string | null) => void;
  setActiveAgentId: (id: string) => void;
  setConnectingId: (id: string | null) => void;
  setAuthOk: (agentId: string, ok: boolean | null) => void;
  setSessionId: (id: string | null) => void;
  applySessionResult: (res: any) => void;
  setModes: (m: ModeState | null) => void;
  setModels: (m: ModelCatalog | null) => void;
  setConfigOptions: (c: any[] | null) => void;
  patchConfigOption: (opt: any) => void;
  setAvailableCommands: (c: Array<{ name: string; description?: string }>) => void;
  setUsage: (u: UsageState | null) => void;
  setSessionInfo: (info: any) => void;
  setMessages: (m: Message[]) => void;
  appendMessage: (m: Message) => void;
  patchMessage: (id: string, patch: Partial<Message> | ((m: Message) => Message)) => void;
  setInput: (v: string) => void;
  setAttachments: (a: Attachment[]) => void;
  setStreaming: (v: boolean) => void;
  setBusy: (v: boolean) => void;
  setDiscovering: (v: boolean) => void;
  setAuthOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setProvidersOpen: (v: boolean) => void;
  setModelsOpen: (v: boolean) => void;
  addPermission: (p: PendingPermission) => void;
  removePermission: (id: string) => void;
  addElicitation: (e: PendingElicitation) => void;
  removeElicitation: (id: string) => void;
  setRespondingId: (id: string | null) => void;
  /** Remember last-used config for an agent (persisted). */
  saveAgentPref: (agentId: string, patch: Partial<Omit<AgentPrefs, "updatedAt">>) => void;
  /** Remember a single configId value for an agent. */
  rememberAgentConfig: (agentId: string, configId: string, value: unknown) => void;
  clearAgentPref: (agentId: string) => void;
  /** Clear thread + session-scoped view state (used on agent switch / new thread). */
  resetThread: () => void;
  /** Full reset (tests / logout flows). */
  resetStudio: () => void;
}

const initialThread = {
  messages: [] as Message[],
  modes: null as ModeState | null,
  models: null as ModelCatalog | null,
  configOptions: null as any[] | null,
  availableCommands: [] as Array<{ name: string; description?: string }>,
  usage: null as UsageState | null,
  sessionInfo: null as any,
  pendingPerms: [] as PendingPermission[],
  pendingElic: [] as PendingElicitation[],
  attachments: [] as Attachment[],
};

function loadInitialWorkspaces(): { current: string | null; recents: RecentWorkspace[] } {
  try {
    const current = localStorage.getItem("acp_current_workspace");
    const raw = localStorage.getItem("acp_recent_workspaces");
    const recents = raw ? JSON.parse(raw) : [];
    return { current: current || null, recents: Array.isArray(recents) ? recents : [] };
  } catch {
    return { current: null, recents: [] };
  }
}

const initialWorkspaces = loadInitialWorkspaces();

const AGENT_PREFS_KEY = "acp_agent_prefs_v1";

function loadAgentPrefs(): Record<string, AgentPrefs> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(AGENT_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, AgentPrefs>;
    }
    return {};
  } catch {
    return {};
  }
}

function persistAgentPrefs(prefs: Record<string, AgentPrefs>) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(AGENT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors (private mode / quota)
  }
}

const initialAgentPrefs = loadAgentPrefs();

export const useStudioStore = create<StudioState>()((set) => ({
  activeAgentId: "codex",
  connectingId: null,
  authOk: {},
  sessionId: null,
  ...initialThread,
  input: "",
  isStreaming: false,
  busy: false,
  discovering: false,
  authOpen: false,
  settingsOpen: false,
  providersOpen: false,
  modelsOpen: false,
  respondingId: null,

  // workspace & desktop tools
  currentWorkspace: initialWorkspaces.current,
  recentWorkspaces: initialWorkspaces.recents,
  terminalOpen: false,
  gitChangesOpen: false,
  gitDiffFile: null,

  agentPrefs: initialAgentPrefs,

  setWorkspace: (targetPath, optName) =>
    set((s) => {
      const name = optName || targetPath.split(/[/\\]/).filter(Boolean).pop() || targetPath;
      const prevRecents = Array.isArray(s.recentWorkspaces) ? s.recentWorkspaces : [];
      const filtered = prevRecents.filter((r) => r.path !== targetPath);
      const nextRecents = [{ path: targetPath, name, lastOpened: Date.now() }, ...filtered].slice(0, 8);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("acp_current_workspace", targetPath);
          localStorage.setItem("acp_recent_workspaces", JSON.stringify(nextRecents));
        }
      } catch {
        // ignore storage errors
      }
      return { currentWorkspace: targetPath, recentWorkspaces: nextRecents };
    }),
  setTerminalOpen: (v) => set({ terminalOpen: v }),
  setGitChangesOpen: (v, file) => set({ gitChangesOpen: v, gitDiffFile: file ?? null }),

  setActiveAgentId: (id) => set({ activeAgentId: id }),
  setConnectingId: (id) => set({ connectingId: id }),
  setAuthOk: (agentId, ok) => set((s) => ({ authOk: { ...s.authOk, [agentId]: ok } })),
  setSessionId: (id) => set({ sessionId: id }),
  applySessionResult: (res: any) =>
    set((s) => ({
      sessionId: res?.sessionId ?? s.sessionId,
      modes: res?.modes ?? s.modes,
      models: res?.models ?? s.models,
      configOptions: res?.configOptions ?? s.configOptions,
      availableCommands: res?.availableCommands ?? s.availableCommands,
    })),
  setModes: (m) => set({ modes: m }),
  setModels: (m) => set({ models: m }),
  setConfigOptions: (c) => set({ configOptions: c }),
  patchConfigOption: (opt) =>
    set((s) => {
      if (!s.configOptions) return { configOptions: [opt] };
      const i = s.configOptions.findIndex((x) => x.id === opt.id);
      if (i >= 0) {
        const next = [...s.configOptions];
        next[i] = opt;
        return { configOptions: next };
      }
      return { configOptions: [...s.configOptions, opt] };
    }),
  setAvailableCommands: (c) => set({ availableCommands: c }),
  setUsage: (u) => set({ usage: u }),
  setSessionInfo: (info) => set({ sessionInfo: info }),
  setMessages: (m) => set({ messages: m }),
  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  patchMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? (typeof patch === "function" ? patch(m) : { ...m, ...patch }) : m)),
    })),
  setInput: (v) => set({ input: v }),
  setAttachments: (a) => set({ attachments: a }),
  setStreaming: (v) => set({ isStreaming: v }),
  setBusy: (v) => set({ busy: v }),
  setDiscovering: (v) => set({ discovering: v }),
  setAuthOpen: (v) => set({ authOpen: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setProvidersOpen: (v) => set({ providersOpen: v }),
  setModelsOpen: (v) => set({ modelsOpen: v }),
  addPermission: (p) => set((s) => ({ pendingPerms: [...s.pendingPerms, p] })),
  removePermission: (id) => set((s) => ({ pendingPerms: s.pendingPerms.filter((x) => x.permissionId !== id) })),
  addElicitation: (e) => set((s) => ({ pendingElic: [...s.pendingElic, e] })),
  removeElicitation: (id) => set((s) => ({ pendingElic: s.pendingElic.filter((x) => x.elicitationId !== id) })),
  setRespondingId: (id) => set({ respondingId: id }),
  saveAgentPref: (agentId, patch) =>
    set((s) => {
      const prev = s.agentPrefs?.[agentId];
      const nextEntry: AgentPrefs = {
        ...(prev || { updatedAt: 0 }),
        ...patch,
        configValues: { ...(prev?.configValues || {}), ...(patch.configValues || {}) },
        updatedAt: Date.now(),
      };
      // patch without configValues should keep old configValues (avoid wipe)
      if (!patch.configValues && prev?.configValues) {
        nextEntry.configValues = prev.configValues;
      }
      const nextPrefs = { ...(s.agentPrefs || {}), [agentId]: nextEntry };
      persistAgentPrefs(nextPrefs);
      return { agentPrefs: nextPrefs };
    }),
  rememberAgentConfig: (agentId, configId, value) =>
    set((s) => {
      const prev = s.agentPrefs?.[agentId];
      const nextEntry: AgentPrefs = {
        ...(prev || { updatedAt: 0 }),
        configValues: { ...(prev?.configValues || {}), [configId]: value },
        updatedAt: Date.now(),
      };
      const nextPrefs = { ...(s.agentPrefs || {}), [agentId]: nextEntry };
      persistAgentPrefs(nextPrefs);
      return { agentPrefs: nextPrefs };
    }),
  clearAgentPref: (agentId) =>
    set((s) => {
      const nextPrefs = { ...(s.agentPrefs || {}) };
      delete nextPrefs[agentId];
      persistAgentPrefs(nextPrefs);
      return { agentPrefs: nextPrefs };
    }),
  resetThread: () => set({ ...initialThread }),
  resetStudio: () =>
    set({
      ...initialThread,
      activeAgentId: "codex",
      connectingId: null,
      authOk: {},
      sessionId: null,
      input: "",
      isStreaming: false,
      busy: false,
      discovering: false,
      authOpen: false,
      settingsOpen: false,
      providersOpen: false,
      modelsOpen: false,
      respondingId: null,
      terminalOpen: false,
      gitChangesOpen: false,
      gitDiffFile: null,
    }),
}));
