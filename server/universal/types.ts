/**
 * Universal ACP gateway types (v1).
 * Covers generic stdio agents: codex-acp, gemini/claude/opencode/copilot, + legacy antigravity.
 */

export interface AgentCommand {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentProfile extends AgentCommand {
  id: string;
  name: string;
  title: string;
  description?: string;
  homepage?: string;
  /** default cwd for sessions when frontend omits it */
  defaultCwd?: string;
  /** whether this profile is built-in (shipped) vs user custom */
  builtin?: boolean;
}

export interface AgentStatus {
  id: string;
  connected: boolean;
  pid?: number | null;
  protocolVersion?: number | null;
  agentInfo?: { name?: string; title?: string; version?: string } | null;
  agentCapabilities?: Record<string, unknown> | null;
  authMethods?: Array<{ id: string; name?: string; description?: string; type?: string }> | null;
  /** `initialize._meta.authStatus` passthrough (e.g. codex), null when unknown. */
  authStatus?: unknown;
  /** Raw `initialize._meta` passthrough, null when unknown. */
  meta?: Record<string, unknown> | null;
  lastError?: string | null;
  startedAt?: string | null;
}

export type UniversalSseEvent =
  | { type: "start"; agentId: string; sessionId: string }
  | { type: "update"; agentId: string; sessionId: string; update: Record<string, unknown> }
  | {
      type: "permission_request";
      agentId: string;
      sessionId: string;
      permissionId: string;
      toolCall?: unknown;
      options?: unknown;
    }
  | {
      type: "elicitation_request";
      agentId: string;
      sessionId: string;
      elicitationId: string;
      message?: string;
      schema?: unknown;
    }
  | { type: "activity"; agentId: string; sessionId: string; kind: string; detail?: unknown }
  | { type: "done"; agentId: string; sessionId: string; stopReason?: string; response?: unknown }
  | { type: "error"; agentId: string; sessionId?: string; message: string };

export interface PendingPermission {
  permissionId: string;
  agentId: string;
  sessionId: string;
  toolCall: unknown;
  options: unknown;
  createdAt: number;
  resolve: (outcome: unknown) => void;
  reject: (err: Error) => void;
}

export interface PendingElicitation {
  elicitationId: string;
  agentId: string;
  sessionId: string;
  message: string;
  schema: unknown;
  createdAt: number;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}
