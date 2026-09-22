/**
 * Universal ACP frontend API + SSE consumer (v1 complete).
 * Talks to server/universal gateway (/api/universal/*).
 */

export interface AgentSummary {
  id: string;
  name: string;
  title: string;
  description?: string;
  command: string;
  args?: string[];
  builtin?: boolean;
  authHint?: string;
  installHint?: string;
  status: {
    connected: boolean;
    pid?: number | null;
    protocolVersion?: number | null;
    agentInfo?: { name?: string; title?: string; version?: string } | null;
    agentCapabilities?: Record<string, any> | null;
    authMethods?: Array<{ id: string; name?: string; description?: string; type?: string }> | null;
    /** initialize._meta.authStatus passthrough (e.g. codex), null when unknown */
    authStatus?: unknown;
    meta?: Record<string, any> | null;
    lastError?: string | null;
  };
}

export interface ToolCallItem {
  id: string;
  title: string;
  kind?: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  content?: unknown;
}

export interface PlanEntry {
  content: string;
  priority?: string;
  status?: string;
}

export interface PendingPermission {
  permissionId: string;
  agentId: string;
  sessionId: string;
  toolCall: any;
  options: Array<{ optionId: string; name: string; kind?: string }>;
}

export interface PendingElicitation {
  elicitationId: string;
  agentId: string;
  sessionId: string;
  message: string;
  schema: any;
}

export interface ConfigOptionLike {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: string;
  currentValue?: unknown;
  options?: Array<{ value: string; name?: string; description?: string }>;
}

/** Current value of a config option as plain string (handles {value} objects). */
export function configCurrentValue(opt: ConfigOptionLike): string {
  const v = opt.currentValue as any;
  if (v == null) return "";
  if (typeof v === "object") return String(v.value ?? "");
  return String(v);
}

/** Map a session config option to a composer role (model / thinking / permission). */
export function findConfigOption(options: ConfigOptionLike[] | null | undefined, role: "model" | "thinking" | "permission"): ConfigOptionLike | undefined {
  if (!options) return undefined;
  const hit = (o: ConfigOptionLike, re: RegExp) => re.test(o.id || "") || re.test(o.name || "") || re.test(o.category || "");
  if (role === "model") return options.find((o) => o.id === "model" || o.category === "model");
  if (role === "thinking") return options.find((o) => hit(o, /reason|effort|think/i));
  return options.find((o) => o.id === "mode" || o.category === "mode");
}

/** Split "gpt-5.6-luna[xhigh]" into model + effort (codex model catalog style). */
export function parseModelId(id: string): { model: string; effort?: string } {
  const m = /^(.*)\[([^\]]+)\]$/.exec(id.trim());
  return m ? { model: m[1], effort: m[2] } : { model: id.trim() };
}

/** Extract thinking / reasoning effort from model parameter string (e.g. Cursor or Codex). */
export function extractModelThinking(modelValue: string | undefined): string | null {
  if (!modelValue) return null;
  const m = /\[(.*)\]$/.exec(modelValue.trim());
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw) return null;
  if (!raw.includes("=")) {
    return raw;
  }
  const params = raw.split(",");
  for (const p of params) {
    const [k, v] = p.split("=").map((s) => s.trim());
    if (!k) continue;
    if (k === "reasoning_effort" || k === "effort" || k === "reasoning") {
      return v || "on";
    }
    if (k === "thinking") {
      return v === "false" ? "off" : "on";
    }
  }
  return null;
}

export interface ModelCatalogEntry {
  modelId: string;
  name?: string;
  description?: string;
}

export interface ModelCatalog {
  availableModels: ModelCatalogEntry[];
  currentModelId?: string;
}

/** A file/image staged in the composer, converted to ACP content blocks on send. */
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  block: Record<string, unknown>;
  /** Local object URL for image thumbnails (not sent). */
  preview?: string;
}

/** ACP "Authentication required" (-32000, reserved ACP range -32000..-32099). */
export const ACP_ERROR_AUTH_REQUIRED = -32000;

export function acpErrorCode(err: unknown): number | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

/** Prefer the gateway's authRequired flag / ACP -32000 code over message sniffing. */
export function isAuthRequiredError(err: unknown): boolean {
  if ((err as { authRequired?: unknown } | null)?.authRequired === true) return true;
  if (acpErrorCode(err) === ACP_ERROR_AUTH_REQUIRED) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /auth_required|authentication required|need[s]? (to )?auth|unauthenticated|not (authenticated|logged in)|login required/i.test(msg);
}

/** Error thrown by gateway wrappers: carries HTTP status + authRequired flag. */
export class GatewayError extends Error {
  authRequired: boolean;
  status: number;
  code?: number;
  constructor(message: string, opts?: { authRequired?: boolean; status?: number; code?: number }) {
    super(message);
    this.name = "GatewayError";
    this.authRequired = !!opts?.authRequired;
    this.status = opts?.status ?? 500;
    if (opts?.code !== undefined) this.code = opts.code;
  }
}

function throwGatewayError(data: any, fallback: string, status = 500): never {
  const errMsg =
    typeof data?.error === "string" && data.error.trim() && data.error !== "null" && data.error !== "undefined"
      ? data.error
      : fallback;
  throw new GatewayError(errMsg, {
    authRequired: !!data?.authRequired,
    status,
    code: typeof data?.code === "number" ? data.code : undefined,
  });
}

export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitStatusResult {
  repo: string;
  branch: string;
  files: GitFileChange[];
}

export interface GitFileResult {
  repo: string;
  file: string;
  binary: boolean;
  truncated: boolean;
  before: string | null;
  after: string | null;
  unified: string | null;
}

export async function gitStatus(cwd: string): Promise<GitStatusResult> {
  const res = await fetch(`/api/universal/git/status?cwd=${encodeURIComponent(cwd)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "git status 失败");
  return data;
}

export async function gitFile(cwd: string, file: string): Promise<GitFileResult> {
  const res = await fetch(`/api/universal/git/file?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(file)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "git diff 失败");
  return data;
}

export async function gitStage(cwd: string, file: string): Promise<void> {
  const res = await fetch("/api/universal/git/stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, file }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "git add 失败");
}

export async function gitRestore(cwd: string, file: string): Promise<void> {
  const res = await fetch("/api/universal/git/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, file }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "git restore 失败");
}

export interface WorkspaceValidateResult {
  ok: boolean;
  path?: string;
  name?: string;
  isGit?: boolean;
  error?: string;
}

export async function getWorkspaceDefault(): Promise<{ path: string; name: string }> {
  const res = await fetch("/api/universal/workspace/default");
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "获取默认工作区失败");
  return data;
}

export async function validateWorkspace(path: string): Promise<WorkspaceValidateResult> {
  const res = await fetch("/api/universal/workspace/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return res.json();
}

export type UnifiedDiffLine =
  | { kind: "hunk"; text: string }
  | { kind: "add"; text: string }
  | { kind: "del"; text: string }
  | { kind: "ctx"; text: string };

/** Parse unified diff into classified lines (skips file headers). */
export function parseUnifiedDiff(unified: string | null): UnifiedDiffLine[] {
  if (!unified) return [];
  const out: UnifiedDiffLine[] = [];
  for (const raw of unified.split("\n")) {
    if (raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("diff --git") || raw.startsWith("index ")) continue;
    if (raw.startsWith("@@")) out.push({ kind: "hunk", text: raw });
    else if (raw.startsWith("+")) out.push({ kind: "add", text: raw.slice(1) });
    else if (raw.startsWith("-")) out.push({ kind: "del", text: raw.slice(1) });
    else if (raw.startsWith(" ")) out.push({ kind: "ctx", text: raw.slice(1) });
    else if (raw === "") continue;
    else if (raw.startsWith("\\")) continue;
    else out.push({ kind: "ctx", text: raw });
  }
  return out.slice(0, 2000);
}

export function guessLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    json: "json", md: "markdown", mdx: "mdx", py: "python",
    rs: "rust", go: "go", css: "css", html: "html",
    yaml: "yaml", yml: "yaml", toml: "toml", sh: "bash",
    ps1: "powershell", c: "c", h: "c", cpp: "cpp", java: "java",
    cs: "csharp", sql: "sql", xml: "xml", vue: "vue",
  };
  return map[ext] || "text";
}

export interface ActivityEvent {
  kind: string;
  detail?: any;
}

export interface UniversalHandlers {
  onSessionId?: (sid: string) => void;
  onTextChunk?: (chunk: string, messageId?: string) => void;
  onThoughtChunk?: (chunk: string) => void;
  onToolCall?: (call: ToolCallItem) => void;
  onToolCallUpdate?: (call: ToolCallItem) => void;
  onPlan?: (entries: PlanEntry[]) => void;
  onAvailableCommands?: (commands: Array<{ name: string; description?: string }>) => void;
  onModeUpdate?: (modeId: string) => void;
  onConfigUpdate?: (option: any) => void;
  onSessionInfo?: (info: any) => void;
  onUsage?: (usage: { used: number; size: number; cost?: { amount: number; currency: string } }) => void;
  /** fs/terminal/compaction and any unrecognized update kinds land here. */
  onActivity?: (a: ActivityEvent) => void;
  onPermissionRequest?: (p: PendingPermission) => void;
  onElicitationRequest?: (e: PendingElicitation) => void;
  onDone?: (stopReason?: string, response?: any) => void;
  onError?: (err: Error) => void;
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const res = await fetch("/api/universal/agents");
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "fetch agents failed");
  return data.agents;
}

const inFlightConnect = new Map<string, Promise<any>>();

export async function connectAgent(agentId: string) {
  if (inFlightConnect.has(agentId)) {
    return inFlightConnect.get(agentId)!;
  }
  const promise = (async () => {
    try {
      const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/connect`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throwGatewayError(data, "connect failed", res.status);
      return data;
    } finally {
      inFlightConnect.delete(agentId);
    }
  })();
  inFlightConnect.set(agentId, promise);
  return promise;
}

export async function agentStatus(agentId: string) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/status`);
  return res.json();
}

export interface CustomAgentInput {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  homepage?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  defaultCwd?: string;
  authHint?: string;
  installHint?: string;
}

export async function upsertAgentProfile(input: CustomAgentInput) {
  const res = await fetch("/api/universal/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "upsert agent failed");
  return data.agent;
}

export async function deleteAgentProfile(agentId: string) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "delete agent failed");
}

export async function authenticateAgent(agentId: string, methodId: string, extra?: Record<string, unknown>) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ methodId, ...(extra || {}) }),
  });
  const data = await res.json();
  if (!data.ok) throwGatewayError(data, "authenticate failed", res.status);
  return data.result;
}

export async function logoutAgent(agentId: string) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/logout`, { method: "POST" });
  const data = await res.json();
  if (!data.ok) throwGatewayError(data, "logout failed", res.status);
  return data.result;
}

export async function sessionNew(agentId: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/session/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: undefined, mcpServers: [], ...args }),
  });
  const data = await res.json();
  if (!data.ok) throwGatewayError(data, "session/new failed", res.status);
  return data.result;
}

export async function sessionRpc(agentId: string, action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/session/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throwGatewayError(data, `${action} failed`, res.status);
  return data.result;
}

/** session/load with replayed history (result + replayed session/update list). */
export async function loadSession(agentId: string, body: Record<string, unknown> = {}): Promise<{ result: any; replayed: any[] }> {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/session/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throwGatewayError(data, "session/load failed", res.status);
  return { result: data.result, replayed: data.replayed || [] };
}

/** UNSTABLE session/fork. */
export async function forkSession(agentId: string, body: Record<string, unknown> = {}) {
  return sessionRpc(agentId, "fork", body);
}

/** UNSTABLE providers/* (list | set | disable). */
export async function providersRpc(agentId: string, action: "list" | "set" | "disable", body: Record<string, unknown> = {}) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/providers/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throwGatewayError(data, `providers/${action} failed`, res.status);
  return data.result;
}

export async function respondPermission(agentId: string, permissionId: string, outcome: unknown) {
  const res = await fetch("/api/universal/permission/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, permissionId, outcome }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "permission respond failed");
}

export async function respondElicitation(agentId: string, elicitationId: string, result: unknown) {
  const res = await fetch("/api/universal/elicitation/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, elicitationId, result }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "elicitation respond failed");
}

/** Consume POST /api/universal/chat SSE stream with full v1 update coverage. */
export async function consumeUniversalChat(
  body: Record<string, unknown>,
  handlers: UniversalHandlers = {},
  signal?: AbortSignal
): Promise<{ stopReason?: string; sessionId?: string }> {
  const res = await fetch("/api/universal/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    throwGatewayError(errJson, `Server ${res.status}: ${res.statusText}`, res.status);
  }
  if (!res.body) throw new Error("No response stream body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sessionId: string | undefined;
  let stopReason: string | undefined;
  let done = false;

  try {
    while (true) {
      const { done: rDone, value } = await reader.read();
      if (rDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        let payload: any;
        try {
          payload = JSON.parse(trimmed.slice(6));
        } catch {
          continue;
        }
        if (payload.type === "start" && payload.sessionId) {
          sessionId = payload.sessionId;
          handlers.onSessionId?.(payload.sessionId);
        } else if (payload.type === "update" && payload.update) {
          const u = payload.update;
          const kind = u.sessionUpdate as string;
          if (kind === "agent_message_chunk" && u.content?.type === "text") {
            handlers.onTextChunk?.(u.content.text, u.messageId);
          } else if (kind === "agent_thought_chunk" && u.content?.type === "text") {
            handlers.onThoughtChunk?.(u.content.text);
          } else if (kind === "user_message_chunk") {
            // replayed history (session/load) — surface as text so UI can rebuild
            if (u.content?.type === "text") handlers.onTextChunk?.(u.content.text, u.messageId);
          } else if (kind === "tool_call") {
            handlers.onToolCall?.({
              id: u.toolCallId,
              title: u.title || "Tool call",
              kind: u.kind,
              status: (u.status as ToolCallItem["status"]) || "pending",
              content: u.content,
            });
          } else if (kind === "tool_call_update") {
            handlers.onToolCallUpdate?.({
              id: u.toolCallId,
              title: u.title || u.toolCallId,
              kind: u.kind,
              status: mapToolStatus(u.status),
              content: u.content,
            });
          } else if (kind === "plan") {
            handlers.onPlan?.((u.entries || []) as PlanEntry[]);
          } else if (kind === "available_commands_update") {
            handlers.onAvailableCommands?.(u.availableCommands || []);
          } else if (kind === "current_mode_update") {
            if (u.currentModeId) handlers.onModeUpdate?.(u.currentModeId);
          } else if (kind === "config_option_update") {
            handlers.onConfigUpdate?.(u.configOption || u);
          } else if (kind === "session_info_update") {
            handlers.onSessionInfo?.(u.sessionInfo || u);
          } else if (kind === "usage_update") {
            handlers.onUsage?.({ used: u.used, size: u.size, cost: u.cost });
          } else if (kind === "plan_update") {
            // UNSTABLE: plan content patch — entries array when present.
            if (Array.isArray(u.plan?.entries)) handlers.onPlan?.(u.plan.entries as PlanEntry[]);
            else handlers.onActivity?.({ kind: "plan_update", detail: u.plan ?? u });
          } else if (kind === "plan_removed") {
            handlers.onActivity?.({ kind: "plan_removed", detail: u });
          } else if (kind === "compaction_update" || kind === "compaction_summary_chunk") {
            handlers.onActivity?.({ kind, detail: u });
          } else {
            // Forward-compatible: never silently drop unknown update kinds.
            handlers.onActivity?.({ kind: kind || "unknown_update", detail: u });
          }
        } else if (payload.type === "activity") {
          handlers.onActivity?.({ kind: payload.kind || "activity", detail: payload.detail });
        } else if (payload.type === "permission_request") {
          handlers.onPermissionRequest?.({
            permissionId: payload.permissionId,
            agentId: payload.agentId,
            sessionId: payload.sessionId,
            toolCall: payload.toolCall,
            options: payload.options || [],
          });
        } else if (payload.type === "elicitation_request") {
          handlers.onElicitationRequest?.({
            elicitationId: payload.elicitationId,
            agentId: payload.agentId,
            sessionId: payload.sessionId,
            message: payload.message || "",
            schema: payload.schema,
          });
        } else if (payload.type === "done") {
          done = true;
          stopReason = payload.stopReason;
          handlers.onDone?.(payload.stopReason, payload.response);
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        } else if (payload.type === "error") {
          done = true;
          handlers.onError?.(new Error(payload.message || "prompt failed"));
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        }
      }
      if (done) break;
    }
  } catch (err: any) {
    if (err?.name === "AbortError") return { stopReason: "cancelled", sessionId };
    if (!done) handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
  }
  return { stopReason, sessionId };
}

function mapToolStatus(s: unknown): ToolCallItem["status"] {
  if (s === "in_progress") return "running";
  if (s === "completed") return "completed";
  if (s === "failed") return "failed";
  if (s === "cancelled") return "cancelled";
  if (s === "pending") return "pending";
  return "running";
}

export interface RebuiltTranscript {
  messages: Array<{
    id?: string;
    role: "user" | "assistant";
    content: string;
    thought?: string;
    toolCalls?: ToolCallItem[];
    messageId?: string;
  }>;
  plan: PlanEntry[];
  usage: { used: number; size: number; cost?: { amount: number; currency: string } } | null;
  availableCommands: Array<{ name: string; description?: string }>;
  currentModeId: string | null;
  sessionTitle?: string;
  sessionGoal?: string | null;
  activities: ActivityEvent[];
}

/**
 * Polymorphic text extractor compatible with all ACP and vendor implementations:
 * supports { text }, { type: "text", text }, raw strings, arrays, or nested { content }.
 */
export function extractText(val: any): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    return val.map(extractText).join("");
  }
  if (typeof val === "object") {
    if (typeof val.text === "string") return val.text;
    if (val.content !== undefined) return extractText(val.content);
    if (typeof val.value === "string") return val.value;
  }
  return "";
}

/**
 * Rebuild a readable transcript from session/load replayed updates.
 * Groups message chunks by messageId or conversational turn; aggregates
 * tool calls into the active assistant turn; folds plan/usage/commands/session_info
 * into metadata instead of cluttering chat history.
 */
export function buildTranscriptFromReplay(replayed: any[]): RebuiltTranscript {
  const out: RebuiltTranscript = {
    messages: [],
    plan: [],
    usage: null,
    availableCommands: [],
    currentModeId: null,
    activities: [],
  };

  const byId = new Map<string, {
    role: "user" | "assistant";
    content: string;
    thought?: string;
    toolCalls?: ToolCallItem[];
    messageId?: string;
  }>();
  const order: string[] = [];
  let seq = 0;
  let lastUserKey: string | null = null;
  let lastAssistantKey: string | null = null;

  const ensureMessage = (role: "user" | "assistant", mid?: string) => {
    if (mid && byId.has(mid)) {
      const existing = byId.get(mid)!;
      existing.role = role;
      return mid;
    }
    const k = mid || `${role}-replay-${seq++}`;
    if (!byId.has(k)) {
      byId.set(k, { role, content: "", messageId: mid, toolCalls: [] });
      order.push(k);
    }
    return k;
  };

  for (const u of replayed || []) {
    const kind = u?.sessionUpdate as string;

    if (kind === "user_message_chunk") {
      const k = u.messageId ? ensureMessage("user", u.messageId) : (lastUserKey || ensureMessage("user"));
      lastUserKey = k;
      lastAssistantKey = null; // Reset assistant turn
      const m = byId.get(k)!;
      m.role = "user";
      m.content += extractText(u);
    } else if (kind === "agent_message_chunk") {
      const k = u.messageId ? ensureMessage("assistant", u.messageId) : (lastAssistantKey || ensureMessage("assistant"));
      lastAssistantKey = k;
      const m = byId.get(k)!;
      m.content += extractText(u);
    } else if (kind === "agent_thought_chunk") {
      const k = u.messageId ? ensureMessage("assistant", u.messageId) : (lastAssistantKey || ensureMessage("assistant"));
      lastAssistantKey = k;
      const m = byId.get(k)!;
      m.thought = (m.thought || "") + extractText(u);
    } else if (kind === "tool_call") {
      // Aggregate tool calls into current assistant turn
      const k = lastAssistantKey || ensureMessage("assistant", u.messageId);
      lastAssistantKey = k;
      const m = byId.get(k)!;
      const newTool: ToolCallItem = {
        id: u.toolCallId || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: u.title || (u.rawInput?.command ? String(u.rawInput.command) : "Tool call"),
        kind: u.kind,
        status: (u.status as ToolCallItem["status"]) || "pending",
      };
      m.toolCalls = [...(m.toolCalls || []), newTool];
    } else if (kind === "tool_call_update") {
      for (const m of byId.values()) {
        const t = m.toolCalls?.find((x) => x.id === u.toolCallId);
        if (t) {
          Object.assign(t, {
            title: u.title || t.title,
            kind: u.kind ?? t.kind,
            status: mapToolStatus(u.status),
          });
          break;
        }
      }
    } else if (kind === "session_info_update") {
      // Extract session title / goal without polluting the chat stream with raw JSON
      if (u.title && typeof u.title === "string") {
        out.sessionTitle = u.title;
      }
      if (u._meta?.goal !== undefined) {
        out.sessionGoal = u._meta.goal;
      }
    } else if (kind === "plan") {
      out.plan = (u.entries || []) as PlanEntry[];
    } else if (kind === "available_commands_update") {
      out.availableCommands = u.availableCommands || [];
    } else if (kind === "current_mode_update" && u.currentModeId) {
      out.currentModeId = u.currentModeId;
    } else if (kind === "usage_update") {
      out.usage = { used: u.used, size: u.size, cost: u.cost };
    } else if (kind) {
      // Only generic unhandled activities
      out.activities.push({ kind, detail: u });
    }
  }

  out.messages = order
    .map((k) => byId.get(k)!)
    .filter((m) => m.content || m.thought || (m.toolCalls && m.toolCalls.length > 0));

  return out;
}
