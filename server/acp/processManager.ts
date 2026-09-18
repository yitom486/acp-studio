import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AntigravityAcpClient } from "./client";
import { resolveOfficialAgyAcpServer, DiscoveredServer } from "./installer";
import {
  InitializeResult,
  SessionNewResult,
  SessionPromptResult,
  SessionModelState,
  ContentBlock,
} from "./types";

export interface ProcessManagerStatus {
  isRunning: boolean;
  serverInfo: {
    executablePath: string;
    version: string;
    source: string;
    harnessPath?: string;
  } | null;
  agentInfo: InitializeResult["agentInfo"] | null;
  agentCapabilities: InitializeResult["agentCapabilities"] | null;
  authMethods: InitializeResult["authMethods"] | null;
  activeSessionsCount: number;
  latestOAuthUrl: string | null;
  hasCredentials: boolean;
  authMethod?: string;
  models: SessionModelState | null;
}

export class AntigravityAcpProcessManager {
  private client: AntigravityAcpClient | null = null;
  private serverMeta: DiscoveredServer | null = null;
  private initResult: InitializeResult | null = null;
  private activeSessions = new Map<string, { createdAt: string; lastPromptAt?: string }>();
  private startPromise: Promise<void> | null = null;
  private latestOAuthUrl: string | null = null;
  private isAuthenticated: boolean = false;
  private lastKnownModels: SessionModelState | null = null;

  constructor(private workingDir: string = process.cwd()) {}

  /**
   * Check if credentials or auth configuration exist in official ~/.gemini/antigravity-acp/ path
   * or system environment.
   */
  public hasStoredCredentials(): { hasStored: boolean; method: string } {
    const geminiDir = path.join(os.homedir(), ".gemini", "antigravity-acp");
    const settingsPath = path.join(geminiDir, "settings.json");

    // 1. Check official settings.json for configured auth type
    if (fs.existsSync(settingsPath)) {
      try {
        const raw = fs.readFileSync(settingsPath, "utf-8");
        const settings = JSON.parse(raw);
        const authType = settings?.auth?.type;
        if (authType) {
          return { hasStored: true, method: authType };
        }
      } catch (err: any) {
        console.warn("[ACP ProcessManager] Warning reading settings.json:", err.message);
      }
    }

    // 2. Check API Key
    if (Boolean(process.env.GEMINI_API_KEY)) {
      return { hasStored: true, method: "gemini-api-key" };
    }

    // 3. Fallback checks for legacy / custom token files
    const personalToken = path.join(geminiDir, "acp_token.json");
    const businessToken = path.join(geminiDir, "acp_business_token.json");
    if (fs.existsSync(personalToken)) {
      return { hasStored: true, method: "oauth-personal" };
    }
    if (fs.existsSync(businessToken)) {
      return { hasStored: true, method: "oauth-business" };
    }

    return { hasStored: false, method: "oauth-personal" };
  }

  /**
   * Start the official agy_acp_server process if not already running.
   */
  public async ensureRunning(): Promise<void> {
    if (this.client && this.client.isAlive()) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      try {
        console.log("[ACP ProcessManager] Discovering official Google Antigravity ACP server...");
        this.serverMeta = await resolveOfficialAgyAcpServer();
        console.log(`[ACP ProcessManager] Found official binary: ${this.serverMeta.executablePath} (${this.serverMeta.source})`);

        this.client = new AntigravityAcpClient({
          executablePath: this.serverMeta.executablePath,
          cwd: this.serverMeta.dir,
          args: ["--debug"],
          requestTimeoutMs: 120000,
          // PyInstaller _MEI extraction dir for the ACP child process goes here
          // instead of %TEMP% on C: (protects the system drive from residue).
          pyTempDir: path.join(this.workingDir, ".acp-tmp"),
          onLog: (line) => {
            console.log("[Official ACP Log]", line);
          },
          onError: (err) => {
            console.error("[ACP ProcessManager Error]", err);
          },
        });

        this.client.onOAuthUrl((url) => {
          this.latestOAuthUrl = url;
        });

        this.client.onExit((code) => {
          console.warn(`[ACP ProcessManager] Official server exited with code: ${code}`);
          this.initResult = null;
          this.startPromise = null;
        });

        await this.client.start();

        // Perform ACP Capability Negotiation via initialize
        console.log("[ACP ProcessManager] Performing ACP initialize handshake...");
        this.initResult = await this.client.initialize({
          protocolVersion: 1,
          clientInfo: {
            name: "AntigravityAcpStudio",
            version: "1.0.0",
          },
          clientCapabilities: {
            fs: { read: true, write: true },
            terminal: true,
          },
        });

        console.log(`[ACP ProcessManager] Initialize succeeded. Agent: ${this.initResult.agentInfo?.title} (${this.initResult.agentInfo?.version})`);
      } finally {
        this.startPromise = null;
      }
    })();

    return this.startPromise;
  }

  public getStatus(): ProcessManagerStatus {
    const credInfo = this.hasStoredCredentials();
    return {
      isRunning: this.client !== null && this.client.isAlive(),
      serverInfo: this.serverMeta
        ? {
            executablePath: this.serverMeta.executablePath,
            version: this.serverMeta.version,
            source: this.serverMeta.source,
            harnessPath: this.serverMeta.harnessPath,
          }
        : null,
      agentInfo: this.initResult?.agentInfo || null,
      agentCapabilities: this.initResult?.agentCapabilities || null,
      authMethods: this.initResult?.authMethods || null,
      activeSessionsCount: this.activeSessions.size,
      latestOAuthUrl: this.inFlightAuthPromise ? this.latestOAuthUrl : null,
      hasCredentials: this.isAuthenticated || credInfo.hasStored,
      authMethod: credInfo.method,
      models: this.lastKnownModels,
    };
  }

  private inFlightAuthPromise: Promise<any> | null = null;

  /**
   * Trigger authentication flow on the official ACP Server.
   * Supports 'oauth-personal', 'oauth-business', 'gemini-api-key', 'agent-platform'.
   */
  public async authenticate(
    methodId: string = "oauth-personal",
    extraParams?: Record<string, any>
  ): Promise<{ ok: boolean; oauthUrl?: string; message?: string }> {
    await this.ensureRunning();
    if (methodId === "gemini-api-key" && extraParams?.apiKey) {
      process.env.GEMINI_API_KEY = extraParams.apiKey;
      this.isAuthenticated = true;
    }

    // Reuse stored credentials without launching browser unless force is requested
    const credInfo = this.hasStoredCredentials();
    if (credInfo.hasStored && !extraParams?.force && methodId === "oauth-personal") {
      this.isAuthenticated = true;
      return {
        ok: true,
        message: "本地 Google 凭证已就绪并成功复用，无需重新授权。",
      };
    }

    // Reuse existing active OAuth session if already listening on loopback port
    if (
      !extraParams?.force &&
      this.inFlightAuthPromise &&
      this.latestOAuthUrl
    ) {
      return {
        ok: true,
        oauthUrl: this.latestOAuthUrl,
        message: "官方 ACP Server 正在等待浏览器授权回调",
      };
    }

    try {
      console.log(`[ACP ProcessManager] Calling official ACP authenticate with method: ${methodId}`);
      this.latestOAuthUrl = null;

      // Launch auth in background with attached catch handler
      this.inFlightAuthPromise = this.client
        .authenticate({ methodId, ...(extraParams || {}) })
        .then((res) => {
          console.log("[ACP ProcessManager] Authentication completed successfully:", res);
          this.isAuthenticated = true;
          this.inFlightAuthPromise = null;
          this.latestOAuthUrl = null;
          return res;
        })
        .catch((err) => {
          console.warn("[ACP ProcessManager] Auth background status:", err.message);
          this.inFlightAuthPromise = null;
          this.latestOAuthUrl = null;
          return null;
        });

      // Wait briefly for OAuth link if it's oauth-personal or oauth-business
      const urlWait = new Promise<string | null>((resolve) => {
        const cleanup = this.client?.onOAuthUrl((url) => {
          cleanup?.();
          resolve(url);
        });
        setTimeout(() => resolve(null), 3500);
      });

      const detectedUrl = await urlWait;

      if (detectedUrl) {
        this.latestOAuthUrl = detectedUrl;
        return {
          ok: true,
          oauthUrl: detectedUrl,
          message: "请在浏览器中完成 Google 账号授权",
        };
      }

      // If already authenticated or completes immediately
      const quickResult = await Promise.race([
        this.inFlightAuthPromise,
        new Promise((r) => setTimeout(r, 2000)),
      ]);

      if (quickResult) {
        return {
          ok: true,
          message: "Google 账号已成功授权并在官方 ACP Server 中生效",
        };
      }

      if (this.latestOAuthUrl) {
        return {
          ok: true,
          oauthUrl: this.latestOAuthUrl,
          message: "请打开 Google 授权链接完成登录",
        };
      }

      return {
        ok: true,
        message: "认证流程已启动，请在浏览器或控制台中完成验证",
      };
    } catch (err: any) {
      if (this.latestOAuthUrl) {
        return {
          ok: true,
          oauthUrl: this.latestOAuthUrl,
          message: "请打开 Google 授权链接完成登录",
        };
      }
      throw new Error(`ACP authenticate failed: ${err.message}`);
    }
  }

  /**
   * Create a new ACP Session on the long-running official server.
   * Parameters match official agy_acp_server requirements: { cwd, mcpServers: [] }
   */
  public async createSession(cwd?: string): Promise<SessionNewResult> {
    await this.ensureRunning();
    if (!this.client) throw new Error("ACP Client not running");

    const effectiveCwd = cwd || this.workingDir;
    const res = await this.client.sessionNew({
      cwd: effectiveCwd,
      mcpServers: [],
    });

    // Capture the real model list advertised by the official ACP server
    // (superseded `models` field; newer spec clients use `configOptions`).
    if (res?.models?.availableModels?.length) {
      this.lastKnownModels = {
        currentModelId: res.models.currentModelId || res.models.availableModels[0].modelId,
        availableModels: res.models.availableModels,
      };
    }

    this.activeSessions.set(res.sessionId, {
      createdAt: new Date().toISOString(),
    });

    return res;
  }

  /**
   * Run prompt on an active ACP session and stream updates.
   */
  public async prompt(
    sessionId: string,
    prompt: ContentBlock[],
    onUpdate: (update: any) => void,
    signal?: AbortSignal
  ): Promise<SessionPromptResult> {
    await this.ensureRunning();
    if (!this.client) throw new Error("ACP Client not running");

    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastPromptAt = new Date().toISOString();
    }

    // Subscribe to session updates from official server
    const unsubscribe = this.client.onSessionUpdate(sessionId, (update) => {
      onUpdate(update);
    });

    // Handle cancellation signal
    const onAbort = () => {
      console.log(`[ACP ProcessManager] Abort requested for session ${sessionId}`);
      this.client?.sessionCancel({ sessionId });
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      return await this.client.sessionPrompt({
        sessionId,
        prompt,
      });
    } finally {
      unsubscribe();
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  /**
   * Get the model list advertised by the official ACP server.
   * Populated from the session/new response; triggers a temp session if unknown.
   */
  public async getModels(): Promise<SessionModelState | null> {
    if (this.lastKnownModels) return this.lastKnownModels;
    try {
      await this.createSession();
    } catch (err: any) {
      console.warn("[ACP ProcessManager] Failed to fetch models via session/new:", err.message);
    }
    return this.lastKnownModels;
  }

  /**
   * Switch an active session to another model. Uses the superseded
   * session/set_model RPC, which the official server still handles.
   */
  public async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    await this.ensureRunning();
    if (!this.client) throw new Error("ACP Client not running");
    await this.client.request("session/set_model", { sessionId, modelId });
    if (this.lastKnownModels) {
      this.lastKnownModels = { ...this.lastKnownModels, currentModelId: modelId };
    }
  }

  /**
   * Cancel an in-flight prompt on an active session.
   */
  public async cancel(sessionId: string): Promise<void> {
    if (!this.client) return;
    await this.client.sessionCancel({ sessionId });
  }

  /**
   * Close a session if the server advertises support for session/close.
   */
  public async closeSession(sessionId: string): Promise<void> {
    this.activeSessions.delete(sessionId);
    if (!this.client || !this.client.isAlive()) return;

    // Check capability negotiation: only call session/close if server supports it!
    const canClose = Boolean(this.initResult?.agentCapabilities?.sessionCapabilities?.close);
    if (canClose) {
      try {
        await this.client.sessionClose({ sessionId });
      } catch (e) {
        console.warn(`[ACP ProcessManager] session/close failed for ${sessionId}:`, e);
      }
    }
  }

  /**
   * Graceful shutdown of the official server process on app exit.
   */
  public async shutdown(): Promise<void> {
    if (this.client) {
      console.log("[ACP ProcessManager] Shutting down official ACP server process...");
      await this.client.stop();
      this.client = null;
    }
    this.activeSessions.clear();
    this.initResult = null;
  }
}
