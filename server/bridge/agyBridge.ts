import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import {
  AgyAcpService,
  discoverAgyCatalog,
  AGENT_INFO,
  BRIDGE_CAPABILITIES,
  type SdkSession,
} from "@yitom/agy-acp-map";

export type BridgeMode = "library" | "process";

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

export class AgyAcpBridge {
  private mode: BridgeMode;
  private service: AgyAcpService | null = null;
  private cachedModels: ModelOption[] = [];
  private currentModelId = "gemini-3.8-flash-high";
  private workingDir: string;
  private sessionModels = new Map<string, string>();
  private activeSessionsCount = 0;

  // Process Mode State (when running in subprocess mode)
  private processSubprocess: ChildProcess | null = null;
  private processNextId = 1;
  private processPending = new Map<number | string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private processSessionListeners = new Map<string, (update: any) => void>();

  constructor(workingDir: string = process.cwd(), mode?: BridgeMode) {
    this.workingDir = workingDir;
    // Mode can be configured via env ACP_BRIDGE_MODE=process or default to library
    this.mode = mode || (process.env.ACP_BRIDGE_MODE === "process" ? "process" : "library");

    if (this.mode === "library") {
      this.service = new AgyAcpService();
    }
  }

  public get currentMode(): BridgeMode {
    return this.mode;
  }

  public setMode(newMode: BridgeMode) {
    if (this.mode === newMode) return;
    this.mode = newMode;
    if (this.mode === "library" && !this.service) {
      this.service = new AgyAcpService();
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

    if (this.mode === "library" && this.service) {
      await this.service.initialize();
    } else if (this.mode === "process") {
      await this.ensureProcessModeServer();
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
            return { id: m, name: m };
          }
          return { id: (m as any).id, name: (m as any).name || (m as any).id };
        });
      }
    } catch {
      // Fallback
    }

    if (this.cachedModels.length === 0) {
      this.cachedModels = [
        { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
        { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
        { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
        { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
        { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)" },
        { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)" },
        { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
        { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
      ];
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
    const targetCwd = cwd || this.workingDir;
    let sessionId: string;

    if (this.mode === "library" && this.service) {
      const res = await this.service.newSession({
        cwd: targetCwd,
        model: this.currentModelId,
        safety: "autonomous-unsandboxed",
      });
      sessionId = res.sessionId;
    } else {
      // Subprocess mode: send session/new over JSON-RPC stdio
      const res = await this.sendProcessRpc("session/new", {
        cwd: targetCwd,
        model: this.currentModelId,
      });
      sessionId = res.sessionId;
    }

    this.activeSessionsCount++;
    this.sessionModels.set(sessionId, this.currentModelId);
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
    if (this.mode === "library" && this.service) {
      this.service.cancelSession({ sessionId });
    } else {
      await this.sendProcessRpc("session/cancel", { sessionId });
    }
  }

  public async prompt(
    sessionId: string,
    promptBlocks: Array<{ type: string; text?: string; [key: string]: any }>,
    onUpdate: (update: any) => void,
    options?: { model?: string; mode?: string }
  ): Promise<{ stopReason: string }> {
    await this.ensureReady();
    const model = options?.model || this.sessionModels.get(sessionId) || this.currentModelId;

    if (this.mode === "library" && this.service) {
      // Auto-register session if not already in memory
      if (!(this.service as any).sessions.has(sessionId)) {
        const res = await this.service.newSession({
          cwd: this.workingDir,
          model,
          safety: "autonomous-unsandboxed",
        });
        const created = (this.service as any).sessions.get(res.sessionId);
        if (created) {
          (this.service as any).sessions.delete(res.sessionId);
          created.sessionId = sessionId;
          (this.service as any).sessions.set(sessionId, created);
        }
      }

      // Library mode: AgyAcpService handles prompt normalization, process supervision, event mapping
      return this.service.promptSession(
        {
          sessionId,
          prompt: promptBlocks,
          model,
        },
        async (update: any) => {
          onUpdate(update);
        }
      );
    } else {
      // Process mode: Register session update callback and send session/prompt
      this.processSessionListeners.set(sessionId, onUpdate);
      try {
        const res = await this.sendProcessRpc("session/prompt", {
          sessionId,
          prompt: promptBlocks,
        });
        return { stopReason: res?.stopReason || "end_turn" };
      } finally {
        this.processSessionListeners.delete(sessionId);
      }
    }
  }

  public getStatus(): BridgeStatus {
    const bin = this.resolveBinaryPath();
    const isReady = fs.existsSync(bin);

    return {
      ok: true,
      isOfficial: true,
      service: `Google Antigravity ACP (${this.mode === "library" ? "Package / Library Mode" : "Subprocess Application Mode"})`,
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
    if (this.processSubprocess) {
      try {
        this.processSubprocess.kill();
      } catch {
        // ignore
      }
      this.processSubprocess = null;
    }
  }

  // --- Subprocess Mode Helpers ---

  private async ensureProcessModeServer(): Promise<void> {
    if (this.processSubprocess && !this.processSubprocess.killed) {
      return;
    }

    const localBin = path.join(this.workingDir, "node_modules", ".bin", process.platform === "win32" ? "agy-acp.cmd" : "agy-acp");
    const binCommand = fs.existsSync(localBin) ? localBin : "agy-acp";

    this.processSubprocess = spawn(binCommand, [], {
      cwd: this.workingDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });

    let buffer = "";
    this.processSubprocess.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          this.handleProcessIncomingMessage(msg);
        } catch {
          // non-json line (e.g. log)
        }
      }
    });

    this.processSubprocess.on("exit", () => {
      this.processSubprocess = null;
    });

    // Send ACP initialize
    await this.sendProcessRpc("initialize", {
      protocolVersion: 2,
      capabilities: {},
      info: { name: "antigravity-studio", version: "1.0.0" },
    });
  }

  private handleProcessIncomingMessage(msg: any) {
    if (msg.id !== undefined && this.processPending.has(msg.id)) {
      const pending = this.processPending.get(msg.id)!;
      this.processPending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error.message || "ACP Error"));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Handle notifications (session/update)
    if (msg.method === "session/update" && msg.params?.sessionId) {
      const listener = this.processSessionListeners.get(msg.params.sessionId);
      if (listener && msg.params.update) {
        listener(msg.params.update);
      }
    }
  }

  private sendProcessRpc(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.processSubprocess || !this.processSubprocess.stdin?.writable) {
        return reject(new Error("ACP process not running"));
      }
      const id = this.processNextId++;
      this.processPending.set(id, { resolve, reject });
      const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      this.processSubprocess.stdin.write(line);
    });
  }
}
