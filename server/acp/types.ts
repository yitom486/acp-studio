// Official ACP (Agent Client Protocol) TypeScript definitions

export interface JsonRpcRequest<T = any> {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = any> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface JsonRpcNotification<T = any> {
  jsonrpc: "2.0";
  method: string;
  params?: T;
}

export interface ClientInfo {
  name: string;
  version: string;
}

export interface ClientCapabilities {
  fs?: {
    read?: boolean;
    write?: boolean;
  };
  terminal?: boolean;
  [key: string]: any;
}

export interface InitializeParams {
  protocolVersion: number;
  clientInfo: ClientInfo;
  clientCapabilities: ClientCapabilities;
}

export interface AuthMethod {
  id: string;
  name: string;
  description: string;
}

export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
    [key: string]: any;
  };
  mcpCapabilities?: {
    http?: boolean;
    sse?: boolean;
    [key: string]: any;
  };
  sessionCapabilities?: {
    list?: Record<string, any>;
    resume?: Record<string, any>;
    close?: Record<string, any>;
    delete?: Record<string, any>;
    [key: string]: any;
  };
  auth?: {
    logout?: Record<string, any>;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface AgentInfo {
  name: string;
  title?: string;
  version: string;
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: AgentCapabilities;
  authMethods: AuthMethod[];
  agentInfo: AgentInfo;
}

export interface AuthenticateParams {
  methodId: string;
  [key: string]: any;
}

export interface SessionNewParams {
  cwd: string;
  mcpServers: any[];
  [key: string]: any;
}

export interface AcpModelInfo {
  modelId: string;
  name?: string;
  description?: string;
  thinkingLevel?: string;
  [key: string]: any;
}

export interface SessionModelState {
  currentModelId: string;
  availableModels: AcpModelInfo[];
  [key: string]: any;
}

export interface SessionNewResult {
  sessionId: string;
  configOptions?: any[];
  models?: SessionModelState;
  modes?: {
    currentModeId?: string;
    availableModes?: { id: string; name?: string; [key: string]: any }[];
    [key: string]: any;
  };
  [key: string]: any;
}

export interface SessionSetModelParams {
  sessionId: string;
  modelId: string;
  [key: string]: any;
}

export interface ContentBlockText {
  type: "text";
  text: string;
}

export interface ContentBlockResource {
  type: "resource";
  resource: {
    uri: string;
    text?: string;
    content?: string;
    [key: string]: any;
  };
}

export type ContentBlock = ContentBlockText | ContentBlockResource | { type: string; [key: string]: any };

export interface SessionPromptParams {
  sessionId: string;
  prompt: ContentBlock[];
  [key: string]: any;
}

export interface SessionPromptResult {
  stopReason?: "end_turn" | "cancelled" | "max_tokens" | string;
  [key: string]: any;
}

export interface SessionCancelParams {
  sessionId: string;
}

export interface SessionCloseParams {
  sessionId: string;
}

export interface SessionUpdateEvent {
  sessionId: string;
  update: {
    sessionUpdate: string;
    content?: any;
    toolCallId?: string;
    toolCall?: any;
    title?: string;
    status?: string;
    [key: string]: any;
  };
}
