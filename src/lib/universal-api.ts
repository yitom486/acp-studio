/**
 * Universal ACP frontend API + SSE consumer (v1 complete).
 * Talks to server/universal gateway (/api/universal/*).
 * Every request goes through apiFetch (adds the gateway Bearer token).
 */
import { apiFetch } from "@/lib/gateway-auth";
import {
  isGenerativeTool,
  appendGenerativeToolPlaceholder,
} from "@/components/assistant/toolkit";

/** usage_update payload: used/size/cost 必有；缓存计数由 agent 透传、有则收。 */
export interface UsageUpdate {
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
  cachedTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** Pick numeric extras off a raw usage_update or done payload (unknown fields never pass).
 * Top level first; supports multi-agent variants:
 * - Codex: cachedReadTokens, cachedInputTokens, _meta.quota.token_count
 * - Claude: cache_read_input_tokens, cacheReadInputTokens
 * - OpenCode / Standard: cachedTokens
 */
export function pickUsageExtras(u: any): Partial<UsageUpdate> {
  if (!u || typeof u !== "object") return {};
  const out: Partial<UsageUpdate> = {};
  const meta = u._meta && typeof u._meta === "object" ? u._meta : {};
  const tokenCount =
    meta.quota?.token_count && typeof meta.quota.token_count === "object"
      ? meta.quota.token_count
      : {};

  // 1. cachedTokens: 提取缓存命中 token 数
  const cachedCandidates = [
    u.cachedTokens,
    u.cachedReadTokens,
    u.cachedInputTokens,
    u.cache_read_input_tokens,
    u.cacheReadInputTokens,
    u.cached_tokens,
    u.prompt_cache_hit_tokens,
    u.prompt_tokens_details?.cached_tokens,
    meta.cachedTokens,
    meta.cachedReadTokens,
    meta.cachedInputTokens,
    meta.cached_tokens,
    meta.prompt_cache_hit_tokens,
    tokenCount.cachedInputTokens,
    tokenCount.cachedReadTokens,
  ];
  for (const val of cachedCandidates) {
    if (typeof val === "number" && Number.isFinite(val)) {
      out.cachedTokens = val;
      break;
    }
  }

  // 2. inputTokens: 提取输入 token 数
  const inputCandidates = [
    u.inputTokens,
    u.input_tokens,
    u.prompt_tokens,
    meta.inputTokens,
    tokenCount.inputTokens,
  ];
  for (const val of inputCandidates) {
    if (typeof val === "number" && Number.isFinite(val)) {
      out.inputTokens = val;
      break;
    }
  }

  // 3. outputTokens: 提取输出 token 数
  const outputCandidates = [
    u.outputTokens,
    u.output_tokens,
    u.completion_tokens,
    meta.outputTokens,
    tokenCount.outputTokens,
  ];
  for (const val of outputCandidates) {
    if (typeof val === "number" && Number.isFinite(val)) {
      out.outputTokens = val;
      break;
    }
  }

  // 4. totalTokens: 提取总 token 数
  const totalCandidates = [
    u.totalTokens,
    u.total_tokens,
    meta.totalTokens,
    tokenCount.totalTokens,
  ];
  for (const val of totalCandidates) {
    if (typeof val === "number" && Number.isFinite(val)) {
      out.totalTokens = val;
      break;
    }
  }

  return out;
}

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
    quota?: any;
    lastError?: string | null;
  };
}

export interface ToolCallItem {
  id: string;
  title: string;
  kind?: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  content?: unknown;
  /**
   * Rich payloads (agent 透传、有则收）：raw tool name / params / file
   * locations / result output / error. Display-only; capped below.
   */
  name?: string;
  rawInput?: unknown;
  locations?: Array<{ path: string; line?: number }>;
  rawOutput?: unknown;
  rawError?: unknown;
}

/** Longest tool text we keep client-side (terminal/file outputs can be huge). */
export const MAX_TOOL_TEXT = 8000;

function capToolText(v: unknown): unknown {
  if (typeof v === "string") {
    return v.length > MAX_TOOL_TEXT ? v.slice(0, MAX_TOOL_TEXT) + "\n…[truncated]" : v;
  }
  return v;
}

/** Pick rich tool payloads off a tool_call(_update) (unknown fields never pass). */
function pickToolExtras(u: any): Partial<ToolCallItem> {
  const out: Partial<ToolCallItem> = {};
  const nameCandidate =
    (typeof u?.name === "string" && u.name) ||
    (typeof u?.toolName === "string" && u.toolName) ||
    (typeof u?.tool === "string" && u.tool) ||
    (typeof u?.function?.name === "string" && u.function.name) ||
    undefined;
  if (nameCandidate) out.name = nameCandidate;

  const inputCandidate =
    u?.rawInput ?? u?.input ?? u?.args ?? u?.arguments ?? u?.parameters ?? u?.params;
  if (inputCandidate !== undefined) out.rawInput = inputCandidate;

  if (Array.isArray(u?.locations)) {
    out.locations = u.locations
      .filter((l: any) => l && typeof l.path === "string")
      .slice(0, 10)
      .map((l: any) => ({ path: l.path, ...(typeof l.line === "number" ? { line: l.line } : {}) }));
  }

  const outputCandidate = u?.rawOutput ?? u?.output ?? u?.result ?? u?.data;
  if (outputCandidate !== undefined) out.rawOutput = capToolText(outputCandidate);

  const errorCandidate = u?.rawError ?? u?.error;
  if (errorCandidate !== undefined) out.rawError = capToolText(errorCandidate);

  return out;
}

/** Strips opaque toolCallIds and synthesizes a readable initial title if needed. */
function cleanToolTitle(rawTitle: unknown, toolCallId?: string, fallbackName?: string, rawInput?: any): string | undefined {
  if (typeof rawTitle === "string" && rawTitle.trim()) {
    const s = rawTitle.trim();
    if (s !== toolCallId && !/^call_[a-zA-Z0-9_-]+$/i.test(s) && !/^tc-\d+-[a-z0-9]+$/i.test(s) && s !== "Tool call") {
      return s;
    }
  }
  if (typeof rawInput?.command === "string" && rawInput.command.trim()) {
    return String(rawInput.command.trim());
  }
  if (typeof fallbackName === "string" && fallbackName.trim()) {
    return fallbackName.trim();
  }
  return undefined;
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

export interface FlattenedOption {
  value: string;
  name: string;
  description?: string;
  group?: string;
}

export interface ConfigOptionLike {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: string;
  currentValue?: unknown;
  options?: Array<any>;
}

/** Flatten flat or grouped ACP options (SessionConfigSelectGroup) into a single list. */
export function flattenConfigOptions(options: any[] | null | undefined): FlattenedOption[] {
  if (!options) return [];
  const result: FlattenedOption[] = [];
  for (const o of options) {
    if (!o) continue;
    if (Array.isArray(o.options)) {
      const grp = o.name || o.group || "";
      for (const sub of o.options) {
        if (!sub) continue;
        result.push({
          value: String(sub.value ?? ""),
          name: sub.name || String(sub.value ?? ""),
          description: sub.description,
          group: grp,
        });
      }
    } else {
      result.push({
        value: String(o.value ?? ""),
        name: o.name || String(o.value ?? ""),
        description: o.description,
      });
    }
  }
  return result;
}

/** Current value of a config option as plain string (handles {value} objects, arrays, and JSON strings). */
export function configCurrentValue(opt: ConfigOptionLike): string {
  const v = opt.currentValue as any;
  if (v == null) return "";
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "object") return String(v.value ?? JSON.stringify(v));
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
  /** 工作区内的 @ 引用（输入框里显示为引用标签；删除标签同时删掉文本里的 @路径） */
  mention?: { path: string; kind: "file" | "dir" };
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
  const res = await apiFetch(`/api/universal/git/status?cwd=${encodeURIComponent(cwd)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "git status 失败");
  return data;
}

export async function gitFile(cwd: string, file: string): Promise<GitFileResult> {
  const res = await apiFetch(`/api/universal/git/file?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(file)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "git diff 失败");
  return data;
}

export async function gitStage(cwd: string, file: string): Promise<void> {
  const res = await apiFetch("/api/universal/git/stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, file }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "git add 失败");
}

export async function gitRestore(cwd: string, file: string): Promise<void> {
  const res = await apiFetch("/api/universal/git/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, file }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "git restore 失败");
}

/** 工作区内容搜索（rg 优先、无则 walk，engine 明示；供文件树搜索条）。 */
export interface SearchMatch {
  file: string;
  line: number;
  col: number;
  text: string;
}
export async function searchWorkspace(
  cwd: string,
  query: string,
  limit = 100
): Promise<{ engine: string; matches: SearchMatch[]; truncated: boolean; elapsedMs: number }> {
  const res = await apiFetch(
    `/api/universal/search?${new URLSearchParams({ cwd, q: query, limit: String(limit) })}`
  );
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "搜索失败");
  return data;
}

/** 真 PTY 可用性（决定抽屉走 WS 交互模式还是回落 one-shot）。 */
export async function ptyStatus(): Promise<{ ok: boolean; available: boolean; reason: string | null }> {
  const res = await apiFetch("/api/universal/terminal/pty/status");
  return res.json();
}

/** PTY 列数同步（抽屉 fit 后调；未知会话 404 即忽略，由重连恢复）。 */
export async function ptyResize(ptyId: string, cols: number, rows: number): Promise<void> {
  const res = await apiFetch("/api/universal/terminal/pty/resize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ptyId, cols, rows }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "pty resize 失败");
}

/** WS 基址候选（纯函数，可测）：自定义远端基址优先，同源次之（prod 与 ws 代理环境），直连回环兜底（vite dev 代理不转 WS）。 */
export function ptyWsCandidateBases(host: string, protocol: string, gatewayPort = 13005, customBase = ""): string[] {
  const wsProto = protocol === "https:" ? "wss:" : "ws:";
  const out: string[] = [];
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };
  const cb = customBase.trim().replace(/\/+$/, "");
  if (cb) push(cb.replace(/^http/i, "ws"));
  const sameOrigin = `${wsProto}//${host}`;
  const loopback = `${wsProto}//127.0.0.1:${gatewayPort}`;
  push(sameOrigin);
  push(loopback);
  return out;
}

/** PTY 连接 URL（纯函数，可测）：ptyId 由客户端生成，resize POST 凭它找会话。 */
export function buildPtyWsUrl(base: string, ptyId: string, cwd: string, cols: number, rows: number): string {
  return `${base}/api/universal/terminal/pty?ptyId=${encodeURIComponent(ptyId)}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}`;
}

/** 本机 WSL 发行版列表（非 Windows 为空；供状态栏远程角标）。 */
export async function listWslDistros(): Promise<string[]> {
  const res = await apiFetch("/api/universal/workspace/wsl-distros");
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "获取 WSL 发行版失败");
  return Array.isArray(data.distros) ? data.distros : [];
}

export interface WorkspaceValidateResult {
  ok: boolean;
  path?: string;
  name?: string;
  isGit?: boolean;
  error?: string;
}

export async function getWorkspaceDefault(): Promise<{ path: string; name: string }> {
  const res = await apiFetch("/api/universal/workspace/default");
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "获取默认工作区失败");
  return data;
}

export async function validateWorkspace(path: string): Promise<WorkspaceValidateResult> {
  const res = await apiFetch("/api/universal/workspace/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return res.json();
}

export interface BrowseDirectoryEntry {
  name: string;
  path: string;
  isGit: boolean;
  mtimeMs?: number;
}

export interface BrowseDirectoryRoot {
  label: string;
  path: string;
  distro?: string;
}

export interface BrowseDirectoriesResult {
  ok: boolean;
  current: string;
  displayPath: string;
  distro?: string | null;
  parent: string | null;
  roots: BrowseDirectoryRoot[];
  entries: BrowseDirectoryEntry[];
  error?: string;
}

export async function browseDirectories(opts?: { dir?: string; distro?: string | null }): Promise<BrowseDirectoriesResult> {
  const params = new URLSearchParams();
  if (opts?.dir) params.set("dir", opts.dir);
  if (opts?.distro) params.set("distro", opts.distro);
  const q = params.toString();
  const res = await apiFetch(`/api/universal/workspace/directories${q ? `?${q}` : ""}`);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    return {
      ok: false,
      current: "",
      displayPath: "",
      parent: null,
      roots: [],
      entries: [],
      error: data?.error || `HTTP ${res.status}: ${res.statusText}`,
    };
  }
  return res.json();
}

export interface LaunchWslResult {
  ok: boolean;
  url?: string;
  distro?: string;
  reused?: boolean;
  token?: string;
  error?: string;
}

export const DEFAULT_WSL_GATEWAY_PORT = 13006;

export async function launchWslGateway(distro: string, port = DEFAULT_WSL_GATEWAY_PORT): Promise<LaunchWslResult> {
  const res = await apiFetch("/api/universal/workspace/wsl-launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ distro, port }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    return {
      ok: false,
      error: data?.error || `启动 WSL 网关失败 (HTTP ${res.status}: ${res.statusText})`,
    };
  }
  return res.json();
}

export interface WorkspaceFileEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

/** List workspace files for @-mentions (substring filter, capped server-side). */
export async function searchWorkspaceFiles(
  cwd: string,
  q: string,
  limit = 50
): Promise<{ repo: string; files: WorkspaceFileEntry[]; truncated: boolean }> {
  const res = await apiFetch(
    `/api/universal/workspace/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(q)}&limit=${limit}`
  );
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "列出工作区文件失败");
  return data;
}

export interface WorkspaceFileContent {
  repo: string;
  file: string;
  mimeType: string;
  size: number;
  text: string;
  truncated: boolean;
}

/** Read a workspace text file for @-mention attachments (capped, no binaries). */
export async function readWorkspaceFile(cwd: string, file: string): Promise<WorkspaceFileContent> {
  const res = await apiFetch(
    `/api/universal/workspace/read?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(file)}`
  );
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "读取文件失败");
  return data;
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

/** Agent-sent image (renderable src + mime). Live-view only (never persisted). */
export interface ChatImage {
  src: string;
  mimeType: string;
}

/** Normalize an ACP image content block to a renderable image (null when unusable). */
export function toChatImage(content: any): ChatImage | null {
  if (!content || typeof content !== "object") return null;
  const mimeType = typeof content.mimeType === "string" && content.mimeType ? content.mimeType : "image/png";
  if (typeof content.data === "string" && content.data) {
    return { src: `data:${mimeType};base64,${content.data}`, mimeType };
  }
  for (const k of ["url", "uri", "src"] as const) {
    const v = (content as Record<string, unknown>)[k];
    if (typeof v === "string" && /^(https?:|data:|blob:)/.test(v)) return { src: v, mimeType };
  }
  return null;
}

export interface UniversalHandlers {
  onSessionId?: (sid: string) => void;
  onTextChunk?: (chunk: string, messageId?: string) => void;
  onThoughtChunk?: (chunk: string) => void;
  onImageChunk?: (img: ChatImage, messageId?: string) => void;
  onToolCall?: (call: ToolCallItem) => void;
  onToolCallUpdate?: (call: ToolCallItem) => void;
  onPlan?: (entries: PlanEntry[]) => void;
  onAvailableCommands?: (commands: Array<{ name: string; description?: string }>) => void;
  onModeUpdate?: (modeId: string) => void;
  onConfigUpdate?: (option: any) => void;
  onSessionInfo?: (info: any) => void;
  onUsage?: (usage: UsageUpdate) => void;
  onQuota?: (quota: any) => void;
  /** fs/terminal/compaction and any unrecognized update kinds land here. */
  onActivity?: (a: ActivityEvent) => void;
  onPermissionRequest?: (p: PendingPermission) => void;
  onElicitationRequest?: (e: PendingElicitation) => void;
  onDone?: (stopReason?: string, response?: any) => void;
  onError?: (err: Error) => void;
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const res = await apiFetch("/api/universal/agents");
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
      const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}/connect`, { method: "POST" });
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
  const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}/status`);
  return res.json();
}

export async function agentQuota(agentId: string) {
  const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}/quota`);
  return res.json();
}

export interface EmptyCleanupResult {
  deleted: string[];
  kept: number;
  errors: Array<{ sessionId: string; error: string }>;
}

/** One-click cleanup of abandoned empty sessions (server reports counts). */
export async function cleanupEmptySessions(
  agentId: string,
  exceptIds: string[] = [],
): Promise<EmptyCleanupResult> {
  const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}/sessions/empty`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exceptIds }),
  });
  const data = await res.json();
  if (!data.ok && (!data || data.deleted === undefined)) {
    throw new Error(data.error || "清理空会话失败");
  }
  if (!data.ok) {
    throw new Error(
      `清理部分失败：已删 ${data.deleted?.length ?? 0} 个，${data.errors?.length ?? 0} 个失败：` +
        (data.errors || []).map((e: any) => `${e.sessionId.slice(0, 8)}…(${e.error})`).join("；"),
    );
  }
  return data;
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
  const res = await apiFetch("/api/universal/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "upsert agent failed");
  return data.agent;
}

export async function deleteAgentProfile(agentId: string) {
  const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "delete agent failed");
}

export async function authenticateAgent(agentId: string, methodId: string, extra?: Record<string, unknown>) {
  const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ methodId, ...(extra || {}) }),
  });
  const data = await res.json();
  if (!data.ok) throwGatewayError(data, "authenticate failed", res.status);
  return data.result;
}

export async function logoutAgent(agentId: string) {
  const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}/logout`, { method: "POST" });
  const data = await res.json();
  if (!data.ok) throwGatewayError(data, "logout failed", res.status);
  return data.result;
}

export async function sessionNew(agentId: string, args: Record<string, unknown> = {}) {
  const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}/session/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: undefined, mcpServers: [], ...args }),
  });
  const data = await res.json();
  if (!data.ok) throwGatewayError(data, "session/new failed", res.status);
  return data.result;
}

export async function getMcpInfo(): Promise<{ port: number; url: string; name: string } | null> {
  try {
    const res = await apiFetch("/api/universal/mcp-info");
    const data = await res.json();
    return data.ok ? data.info : null;
  } catch {
    return null;
  }
}

export async function sessionRpc(agentId: string, action: string, body: Record<string, unknown> = {}) {
  const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}/session/${action}`, {
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
  const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}/session/load`, {
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
  const res = await apiFetch(`/api/universal/agents/${encodeURIComponent(agentId)}/providers/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throwGatewayError(data, `providers/${action} failed`, res.status);
  return data.result;
}

export async function respondPermission(agentId: string, permissionId: string, outcome: unknown) {
  const res = await apiFetch("/api/universal/permission/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, permissionId, outcome }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "permission respond failed");
}

export async function respondElicitation(agentId: string, elicitationId: string, result: unknown) {
  const res = await apiFetch("/api/universal/elicitation/respond", {
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
  const res = await apiFetch("/api/universal/chat", {
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
        if (payload.quota) {
          handlers.onQuota?.(payload.quota);
        }
        if (payload.type === "start" && payload.sessionId) {
          sessionId = payload.sessionId;
          handlers.onSessionId?.(payload.sessionId);
        } else if (payload.type === "update" && payload.update) {
          const u = payload.update;
          const kind = u.sessionUpdate as string;
          if (kind === "agent_message_chunk" && u.content?.type === "text") {
            handlers.onTextChunk?.(u.content.text, u.messageId);
          } else if (kind === "agent_message_chunk" && u.content?.type === "image") {
            const img = toChatImage(u.content);
            if (img) handlers.onImageChunk?.(img, u.messageId);
          } else if (kind === "agent_thought_chunk" && u.content?.type === "text") {
            handlers.onThoughtChunk?.(u.content.text);
          } else if (kind === "user_message_chunk") {
            // replayed history (session/load) — surface as text so UI can rebuild
            if (u.content?.type === "text") handlers.onTextChunk?.(u.content.text, u.messageId);
          } else if (kind === "tool_call") {
            const resolvedTitle = cleanToolTitle(u.title, u.toolCallId, u.name, u.rawInput) || "Tool call";
            handlers.onToolCall?.({
              id: u.toolCallId,
              title: resolvedTitle,
              kind: u.kind,
              status: (u.status as ToolCallItem["status"]) || "pending",
              content: u.content,
              ...pickToolExtras(u),
            });
          } else if (kind === "tool_call_update") {
            const resolvedTitle = cleanToolTitle(u.title, u.toolCallId, u.name, u.rawInput);
            handlers.onToolCallUpdate?.({
              id: u.toolCallId,
              title: resolvedTitle || "",
              kind: u.kind,
              status: mapToolStatus(u.status),
              content: u.content,
              ...pickToolExtras(u),
            });
          } else if (kind === "plan") {
            handlers.onPlan?.((u.entries || []) as PlanEntry[]);
          } else if (kind === "available_commands_update") {
            handlers.onAvailableCommands?.(u.availableCommands || []);
          } else if (kind === "current_mode_update") {
            if (u.currentModeId) handlers.onModeUpdate?.(u.currentModeId);
          } else if (kind === "config_option_update") {
            handlers.onConfigUpdate?.(u.configOption || u);
          } else if (kind === "config_options_update") {
            if (Array.isArray(u.configOptions)) {
              for (const opt of u.configOptions) {
                handlers.onConfigUpdate?.(opt);
              }
            }
          } else if (kind === "session_info_update") {
            handlers.onSessionInfo?.(u.sessionInfo || u);
          } else if (kind === "usage_update") {
            handlers.onUsage?.({ used: u.used, size: u.size, cost: u.cost, ...pickUsageExtras(u) });
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
          const resp = payload.response;
          if (resp && (resp.usage || resp._meta)) {
            const rawUsage = resp.usage || {};
            const extras = pickUsageExtras({ ...rawUsage, _meta: resp._meta });
            const total = extras.totalTokens ?? rawUsage.totalTokens;
            handlers.onUsage?.({
              used: typeof rawUsage.used === "number" ? rawUsage.used : (typeof total === "number" ? total : 0),
              size: typeof rawUsage.size === "number" ? rawUsage.size : 0,
              cost: rawUsage.cost,
              ...extras,
            });
          }
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
    images?: ChatImage[];
    messageId?: string;
  }>;
  plan: PlanEntry[];
  usage: UsageUpdate | null;
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
    images?: ChatImage[];
    messageId?: string;
  }>();
  const order: string[] = [];
  let seq = 0;
  let lastUserKey: string | null = null;
  let lastAssistantKey: string | null = null;
  let lastAssistantStepId: string | null = null;
  let lastThoughtStepId: string | null = null;

  const ensureMessage = (role: "user" | "assistant", mid?: string) => {
    if (mid && byId.has(mid)) {
      const existing = byId.get(mid)!;
      existing.role = role;
      return mid;
    }
    const k = mid || `${role}-replay-${seq++}`;
    if (!byId.has(k)) {
      byId.set(k, { role, content: "", messageId: mid, toolCalls: [], images: [] });
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
      lastAssistantStepId = null;
      lastThoughtStepId = null;
      const m = byId.get(k)!;
      m.role = "user";
      m.content += extractText(u);
      // 回放里用户发过的图片（ACP image 块）
      const uimg = u.content?.type === "image" ? toChatImage(u.content) : null;
      if (uimg) m.images = [...(m.images || []), uimg].slice(-8);
    } else if (kind === "agent_message_chunk") {
      // Aggregate into current assistant turn so intermediate step messageIds don't fragment the bubble
      const k = lastAssistantKey || ensureMessage("assistant", u.messageId);
      lastAssistantKey = k;
      lastUserKey = null;
      const m = byId.get(k)!;
      const newText = extractText(u);
      if (newText) {
        // If this text chunk belongs to a new step (different messageId) and follows previous text,
        // separate cleanly with double newline if previous text did not end with newline.
        const isNewStep = Boolean(u.messageId && lastAssistantStepId && u.messageId !== lastAssistantStepId);
        if (isNewStep && m.content && !m.content.endsWith("\n") && !newText.startsWith("\n")) {
          m.content += "\n\n" + newText;
        } else {
          m.content += newText;
        }
        if (u.messageId) {
          lastAssistantStepId = u.messageId;
        }
      }
      const img = u.content?.type === "image" ? toChatImage(u.content) : null;
      if (img) m.images = [...(m.images || []), img].slice(-8);
    } else if (kind === "agent_thought_chunk") {
      // Aggregate thoughts into current assistant turn
      const k = lastAssistantKey || ensureMessage("assistant", u.messageId);
      lastAssistantKey = k;
      lastUserKey = null;
      const m = byId.get(k)!;
      const thoughtText = extractText(u);
      if (thoughtText) {
        const isNewStep = Boolean(u.messageId && lastThoughtStepId && u.messageId !== lastThoughtStepId);
        if (isNewStep && m.thought && !m.thought.endsWith("\n") && !thoughtText.startsWith("\n")) {
          m.thought += "\n\n" + thoughtText;
        } else {
          m.thought = (m.thought || "") + thoughtText;
        }
        if (u.messageId) {
          lastThoughtStepId = u.messageId;
        }
      }
    } else if (kind === "tool_call") {
      // Aggregate tool calls into current assistant turn
      const k = lastAssistantKey || ensureMessage("assistant", u.messageId);
      lastAssistantKey = k;
      lastUserKey = null;
      const m = byId.get(k)!;
      const newTool: ToolCallItem = {
        id: u.toolCallId || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: cleanToolTitle(u.title, u.toolCallId, u.name, u.rawInput) || "Tool call",
        kind: u.kind,
        status: (u.status as ToolCallItem["status"]) || "pending",
        ...pickToolExtras(u),
      };
      const existing = m.toolCalls?.find((x) => x.id === newTool.id);
      if (existing) {
        Object.assign(existing, newTool);
      } else {
        m.toolCalls = [...(m.toolCalls || []), newTool];
      }
      if (isGenerativeTool(existing || newTool)) {
        m.content = appendGenerativeToolPlaceholder(m.content, newTool.id);
      }
    } else if (kind === "tool_call_update") {
      for (const m of byId.values()) {
        const t = m.toolCalls?.find((x) => x.id === u.toolCallId);
        if (t) {
          const updTitle = cleanToolTitle(u.title, u.toolCallId, u.name, u.rawInput);
          Object.assign(t, {
            title: updTitle || t.title,
            kind: u.kind ?? t.kind,
            status: mapToolStatus(u.status),
            ...pickToolExtras(u),
          });
          if (isGenerativeTool(t)) {
            m.content = appendGenerativeToolPlaceholder(m.content, t.id);
          }
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
      out.usage = { used: u.used, size: u.size, cost: u.cost, ...pickUsageExtras(u) };
    } else if (kind) {
      // Only generic unhandled activities
      out.activities.push({ kind, detail: u });
    }
  }

  out.messages = order
    .map((k) => byId.get(k)!)
    .filter((m) => m.content || m.thought || (m.toolCalls && m.toolCalls.length > 0) || (m.images && m.images.length > 0));

  return out;
}
