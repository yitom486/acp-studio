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

export async function connectAgent(agentId: string) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/connect`, { method: "POST" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "connect failed");
  return data;
}

export async function agentStatus(agentId: string) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/status`);
  return res.json();
}

export async function authenticateAgent(agentId: string, methodId: string, extra?: Record<string, unknown>) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ methodId, ...(extra || {}) }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "authenticate failed");
  return data.result;
}

export async function logoutAgent(agentId: string) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/logout`, { method: "POST" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "logout failed");
  return data.result;
}

export async function sessionNew(agentId: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/session/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: undefined, mcpServers: [], ...args }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "session/new failed");
  return data.result;
}

export async function sessionRpc(agentId: string, action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`/api/universal/agents/${encodeURIComponent(agentId)}/session/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `${action} failed`);
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
    throw new Error(errJson?.error || `Server ${res.status}: ${res.statusText}`);
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
          }
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
