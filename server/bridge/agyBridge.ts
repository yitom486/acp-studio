import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  AgyAcpService,
  discoverAgyCatalog,
  AGENT_INFO,
  BRIDGE_CAPABILITIES,
  type SdkSession,
} from "@yitom/agy-acp-map";

export type BridgeMode = "library";

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
}

export interface BridgeStatus {
  ok: boolean;
  isOfficial: boolean;
  service: string;
  mode: BridgeMode;
  protocol: string;
  packageVersion: string;
  agentInfo: {
    name: string;
    title: string;
    version: string;
  };
  agentCapabilities: {
    loadSession: boolean;
    streaming: boolean;
    tools: boolean;
    nativeCli: boolean;
  };
  auth: {
    authenticated: boolean;
    method: string;
    authMethods: Array<{ id: string; name: string; description: string }>;
    latestOAuthUrl: string | null;
  };
  binary: {
    executablePath: string;
    version: string;
    source: string;
  };
  models: ModelOption[];
  currentModelId: string;
  activeSessionsCount: number;
}

// Ensure execution environment has proper Google Antigravity binary and network proxy
function setupEnvironment() {
  const userBin = path.join(os.homedir(), ".gemini", "bin");
  const exeName = process.platform === "win32" ? "agy.exe" : "agy";
  const defaultAgy = path.join(userBin, exeName);

  if (!process.env.AGY_BIN && fs.existsSync(defaultAgy)) {
    process.env.AGY_BIN = defaultAgy;
  }

  // Ensure PATH contains ~/.gemini/bin
  const currentPath = process.env.PATH || "";
  if (fs.existsSync(userBin) && !currentPath.split(path.delimiter).includes(userBin)) {
    process.env.PATH = `${userBin}${path.delimiter}${currentPath}`;
  }

  // Default proxy if Clash/v2ray is on 7897
  const defaultProxy = "http://127.0.0.1:7897";
  if (!process.env.HTTP_PROXY && !process.env.http_proxy) {
    process.env.HTTP_PROXY = defaultProxy;
  }
  if (!process.env.HTTPS_PROXY && !process.env.https_proxy) {
    process.env.HTTPS_PROXY = defaultProxy;
  }
  if (!process.env.ALL_PROXY && !process.env.all_proxy) {
    process.env.ALL_PROXY = "socks5://127.0.0.1:7897";
  }
}

setupEnvironment();

export const DEFAULT_AGY_MODELS_CATALOG: ModelOption[] = [
  { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)", description: "Default high-speed reasoning" },
  { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)", description: "Balanced performance & speed" },
  { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)", description: "Ultra-fast low-latency" },
  { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", description: "Google Gemini 3.7 Flash High" },
  { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", description: "Google Gemini 3.7 Flash Medium" },
  { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", description: "Google Gemini 3.7 Flash Low" },
  { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)", description: "Google Gemini 3.6 Flash High" },
  { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)", description: "Google Gemini 3.6 Flash Medium" },
  { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)", description: "Google Gemini 3.6 Flash Low" },
  { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)", description: "Google Gemini 3.1 Pro High" },
  { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", description: "Google Gemini 3.1 Pro Low" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", description: "Anthropic Claude 4.6 Sonnet" },
  { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", description: "Anthropic Claude 4.6 Opus" },
  { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", description: "Open-source 120B model" },
];

export class AgyAcpBridge {
  private mode: BridgeMode = "library";
  private service: AgyAcpService | null = null;
  private cachedModels: ModelOption[] = [...DEFAULT_AGY_MODELS_CATALOG];
  private currentModelId = "gemini-3.8-flash-high";
  private workingDir: string;
  private sessionModels = new Map<string, string>();
  private activeSessionsCount = 0;

  constructor(workingDir: string = process.cwd()) {
    this.workingDir = workingDir;
    // Library-only since the hand-rolled process mode was removed:
    // generic stdio agents go through server/universal instead.
    this.service = new AgyAcpService();
  }

  public get currentMode(): BridgeMode {
    return this.mode;
  }

  public setMode(newMode: BridgeMode) {
    // Compat no-op: only "library" is supported. The legacy
    // /api/bridge/mode endpoint keeps working and reports library.
    if (newMode !== "library") {
      console.warn(`[ACP-BRIDGE] ignoring unsupported bridge mode '${newMode}', staying on library`);
    }
  }

  public resolveBinaryPath(): string {
    return process.env.AGY_BIN || "agy";
  }

  public async ensureReady(): Promise<void> {
    const bin = this.resolveBinaryPath();
    if (path.isAbsolute(bin) && !fs.existsSync(bin)) {
      throw new Error(`Google Antigravity CLI (agy) not found at: ${bin}`);
    }
  }

  public async init(): Promise<void> {
    await this.ensureReady();

    if (this.service) {
      await this.service.initialize();
    }

    // Prefetch model list
    await this.getModels();
  }

  /**
   * Discovers models supported by agy.
   */
  public async getModels(): Promise<{ currentModelId: string; availableModels: ModelOption[] }> {
    if (this.cachedModels.length > 0) {
      return {
        currentModelId: this.currentModelId,
        availableModels: this.cachedModels,
      };
    }

    try {
      const catalog = await discoverAgyCatalog({ bin: this.resolveBinaryPath() });
      if (catalog.availableModels && catalog.availableModels.length > 0) {
        this.cachedModels = catalog.availableModels.map((m) => {
          if (typeof m === "string") {
            const found = DEFAULT_AGY_MODELS_CATALOG.find((x) => x.id === m);
            return found || { id: m, name: m };
          }
          return { id: (m as any).id, name: (m as any).name || (m as any).id };
        });
      }
    } catch {
      // Fallback
    }

    if (this.cachedModels.length === 0) {
      this.cachedModels = [...DEFAULT_AGY_MODELS_CATALOG];
    }

    if (!this.cachedModels.some((m) => m.id === this.currentModelId)) {
      this.currentModelId = this.cachedModels[0].id;
    }

    return {
      currentModelId: this.currentModelId,
      availableModels: this.cachedModels,
    };
  }

  public async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    this.currentModelId = modelId;
    this.sessionModels.set(sessionId, modelId);
  }

  public async createSession(cwd?: string): Promise<{ sessionId: string; models: any }> {
    await this.ensureReady();
    if (!this.service) throw new Error("Antigravity bridge not initialized");
    const targetCwd = cwd || this.workingDir;

    const res = await this.service.newSession({
      cwd: targetCwd,
      model: this.currentModelId,
      safety: "autonomous-unsandboxed",
    });
    const sessionId = res.sessionId;

    this.activeSessionsCount++;
    this.sessionModels.set(sessionId, this.currentModelId);
    console.log(`[ACP-BRIDGE] createSession: created sessionId: ${sessionId} (model: ${this.currentModelId}, activeSessions: ${this.activeSessionsCount})`);
    const models = await this.getModels();

    return {
      sessionId,
      models: {
        currentModelId: this.currentModelId,
        availableModels: models.availableModels,
      },
    };
  }

  public async cancel(sessionId: string): Promise<void> {
    console.log(`[ACP-BRIDGE] cancel: stopping session: ${sessionId}`);
    this.service?.cancelSession({ sessionId });
  }

  public async prompt(
    sessionId: string,
    promptBlocks: Array<{ type: string; text?: string; [key: string]: any }>,
    onUpdate: (update: any) => void,
    options?: { model?: string; mode?: string }
  ): Promise<{ stopReason: string }> {
    await this.ensureReady();
    if (!this.service) throw new Error("Antigravity bridge not initialized");
    const service = this.service;
    const model = options?.model || this.sessionModels.get(sessionId) || this.currentModelId;
    console.log(`[ACP-BRIDGE] prompt called: sid: ${sessionId}, model: ${model}, promptPreview: "${JSON.stringify(promptBlocks).slice(0, 80)}"`);

    // Auto-register session if not already in memory
    if (!(service as any).sessions.has(sessionId)) {
      console.log(`[ACP-BRIDGE] session ${sessionId} not in memory, registering fresh session`);
      const res = await service.newSession({
        cwd: this.workingDir,
        model,
        safety: "autonomous-unsandboxed",
      });
      const created = (service as any).sessions.get(res.sessionId);
      if (created) {
        (service as any).sessions.delete(res.sessionId);
        created.sessionId = sessionId;
        (service as any).sessions.set(sessionId, created);
      }
    }

    // AgyAcpService handles prompt normalization, process supervision, event mapping
    const outcome = await service.promptSession(
      {
        sessionId,
        prompt: promptBlocks,
        model,
      },
      async (update: any) => {
        console.log(`[ACP-BRIDGE] update from SDK (sid: ${sessionId}): ${update?.sessionUpdate || 'unknown'}`);
        onUpdate(update);
      }
    );
    console.log(`[ACP-BRIDGE] prompt completed (sid: ${sessionId}) with stopReason: ${outcome.stopReason}`);
    return outcome;
  }

  public getStatus(): BridgeStatus {
    const bin = this.resolveBinaryPath();
    const isReady = fs.existsSync(bin);

    return {
      ok: true,
      isOfficial: true,
      service: `Google Antigravity ACP (Package / Library Mode)`,
      mode: this.mode,
      protocol: "Agent Client Protocol v2 (stream-json bridge)",
      packageVersion: AGENT_INFO.version,
      agentInfo: AGENT_INFO,
      agentCapabilities: {
        loadSession: true,
        streaming: true,
        tools: true,
        nativeCli: true,
      },
      auth: {
        authenticated: isReady,
        method: "google-antigravity-auth",
        authMethods: [
          {
            id: "google-antigravity-auth",
            name: "Google Antigravity Auth",
            description: "Direct reuse of authenticated environment from Antigravity CLI",
          },
        ],
        latestOAuthUrl: null,
      },
      binary: {
        executablePath: bin,
        version: `@yitom/agy-acp-map@${AGENT_INFO.version}`,
        source: "npm:@yitom/agy-acp-map",
      },
      models: this.cachedModels,
      currentModelId: this.currentModelId,
      activeSessionsCount: this.activeSessionsCount,
    };
  }

  public async shutdown(): Promise<void> {
    // Library mode holds no subprocess: nothing to tear down.
    // (Generic stdio agents are owned by server/universal/registry.)
  }
}
