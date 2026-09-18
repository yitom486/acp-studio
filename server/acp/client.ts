import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  InitializeParams,
  InitializeResult,
  AuthenticateParams,
  SessionNewParams,
  SessionNewResult,
  SessionPromptParams,
  SessionPromptResult,
  SessionCancelParams,
  SessionCloseParams,
} from "./types";
import * as fs from "node:fs";

export interface AcpClientOptions {
  executablePath: string;
  cwd: string;
  args?: string[];
  requestTimeoutMs?: number;
  onLog?: (line: string) => void;
  onError?: (err: Error) => void;
  pyTempDir?: string;
}

export class AntigravityAcpClient {
  private proc: any = null;
  private nextId = 1;
  private pendingRequests = new Map<
    number | string,
    {
      resolve: (val: any) => void;
      reject: (err: Error) => void;
      timer: any;
      method: string;
    }
  >();

  private sessionUpdateListeners = new Map<string, Set<(update: any) => void>>();
  private oauthUrlListeners = new Set<(url: string) => void>();
  private exitListeners = new Set<(code: number | null) => void>();

  private isStarted = false;
  private isShuttingDown = false;
  private latestOAuthUrl: string | null = null;

  constructor(private readonly options: AcpClientOptions) {}

  public get currentOAuthUrl(): string | null {
    return this.latestOAuthUrl;
  }

  public isAlive(): boolean {
    return this.isStarted && this.proc !== null && this.proc.exitCode === null;
  }

  /**
   * Spawn agy_acp_server and establish NDJSON JSON-RPC over stdio.
   */
  public async start(): Promise<void> {
    if (this.isAlive()) return;

    this.isShuttingDown = false;
    const args = this.options.args || [];

    if (this.options.pyTempDir) {
      try { fs.mkdirSync(this.options.pyTempDir, { recursive: true }); } catch {}
    }

    const defaultProxy = "http://127.0.0.1:7897";
    const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy || defaultProxy;
    const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || defaultProxy;
    const allProxy = process.env.ALL_PROXY || process.env.all_proxy || "socks5://127.0.0.1:7897";

    const env = {
      ...process.env,
      HTTP_PROXY: httpProxy,
      HTTPS_PROXY: httpsProxy,
      http_proxy: httpProxy,
      https_proxy: httpsProxy,
      ALL_PROXY: allProxy,
      all_proxy: allProxy,
      NO_PROXY: "localhost,127.0.0.1,::1",
      no_proxy: "localhost,127.0.0.1,::1",
      // PyInstaller onefile extracts its runtime to %TEMP%\_MEIxxxx (~1GB each).
      // Redirect to a dedicated dir on the project drive so forced kills can
      // never fill up C:. Stale dirs are swept by server/index.ts on startup.
      TMP: this.options.pyTempDir || process.env.TMP,
      TEMP: this.options.pyTempDir || process.env.TEMP,
    };

    // Ensure we do NOT use shell strings. Use array of arguments.
    this.proc = Bun.spawn([this.options.executablePath, ...args], {
      cwd: this.options.cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    this.isStarted = true;

    // Handle stdout: Strict NDJSON JSON-RPC 2.0 stream
    this.readStdoutLoop();

    // Handle stderr: Separate diagnostic logging & OAuth URL extraction
    this.readStderrLoop();

    // Handle process exit
    this.proc.exited.then((code: number) => {
      this.isStarted = false;
      const isClean = this.isShuttingDown;
      if (!isClean) {
        console.warn(`[ACP Client] agy_acp_server process exited unexpectedly with code ${code}`);
      }
      for (const [id, req] of this.pendingRequests.entries()) {
        clearTimeout(req.timer);
        req.reject(new Error(`Server process terminated with code ${code} while waiting for ${req.method} response`));
      }
      this.pendingRequests.clear();
      for (const fn of this.exitListeners) {
        try {
          fn(code);
        } catch {}
      }
    });
  }

  /**
   * Send JSON-RPC request and await response with pending map.
   */
  public async request<TResult = any>(method: string, params?: any): Promise<TResult> {
    if (!this.isAlive()) {
      throw new Error(`Cannot send ACP request '${method}': agy_acp_server process is not running.`);
    }

    const id = this.nextId++;
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const timeoutMs =
      method === "authenticate"
        ? 600000
        : (this.options.requestTimeoutMs || 60000);

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`ACP request '${method}' (id ${id}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timer,
        method,
      });

      this.sendRaw(JSON.stringify(req) + "\n");
    });
  }

  /**
   * Send JSON-RPC notification (one-way).
   */
  public notify(method: string, params?: any): void {
    if (!this.isAlive()) return;
    const notif: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.sendRaw(JSON.stringify(notif) + "\n");
  }

  private sendRaw(line: string): void {
    try {
      this.proc.stdin.write(line);
      this.proc.stdin.flush();
    } catch (err: any) {
      this.options.onError?.(new Error(`Failed to write to agy_acp_server stdin: ${err.message}`));
    }
  }

  private async readStdoutLoop(): Promise<void> {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this.handleStdoutLine(trimmed);
        }
      }
    } catch (err: any) {
      if (!this.isShuttingDown) {
        this.options.onError?.(new Error(`Stdout stream error: ${err.message}`));
      }
    }
  }

  private handleStdoutLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      // Not a valid JSON-RPC message (e.g. unexpected raw text)
      console.warn("[ACP Client] Ignoring non-JSON line from stdout:", line);
      return;
    }

    // 1. Response to pending request
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(
            new Error(`ACP error ${msg.error.code}: ${msg.error.message}`)
          );
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // 2. Server-to-client request (needs a response back)
    if (msg.method && msg.id !== undefined) {
      this.handleServerRequest(msg);
      return;
    }

    // 3. Server-to-client notification
    if (msg.method && msg.id === undefined) {
      this.handleServerNotification(msg);
      return;
    }
  }

  private handleServerRequest(msg: { id: number | string; method: string; params?: any }): void {
    // E.g. client/session/requestPermission, etc.
    // Default auto-grant or dispatch
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: msg.id,
      result: { outcome: "accept" },
    };
    this.sendRaw(JSON.stringify(response) + "\n");
  }

  private handleServerNotification(msg: { method: string; params?: any }): void {
    // E.g. session/update or client/session/update
    if (
      msg.method === "session/update" ||
      msg.method === "client/session/update" ||
      msg.method === "session_update"
    ) {
      const sessionId = msg.params?.sessionId;
      const update = msg.params?.update ?? msg.params;
      if (sessionId && this.sessionUpdateListeners.has(sessionId)) {
        for (const listener of this.sessionUpdateListeners.get(sessionId)!) {
          try {
            listener(update);
          } catch (e) {
            console.error("[ACP Client] Listener error in session update:", e);
          }
        }
      }
    }
  }

  private async readStderrLoop(): Promise<void> {
    const reader = this.proc.stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          this.options.onLog?.(trimmed);

          // Check for OAuth authentication link
          // Pattern: "Open the following link to authenticate the ACP server: https://accounts.google.com/..."
          if (trimmed.includes("https://accounts.google.com/o/oauth2/")) {
            const match = trimmed.match(/(https:\/\/accounts\.google\.com\/[^\s]+)/);
            if (match && match[1]) {
              const url = match[1];
              this.latestOAuthUrl = url;
              console.log("[ACP Client] Detected Google OAuth URL:", url);
              for (const fn of this.oauthUrlListeners) {
                try {
                  fn(url);
                } catch {}
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // --- High-level ACP Protocol Methods ---

  public async initialize(params: InitializeParams): Promise<InitializeResult> {
    return this.request<InitializeResult>("initialize", params);
  }

  public async authenticate(params: AuthenticateParams): Promise<any> {
    return this.request("authenticate", params);
  }

  public async logout(): Promise<any> {
    return this.request("logout", {});
  }

  public async sessionNew(params: SessionNewParams): Promise<SessionNewResult> {
    return this.request<SessionNewResult>("session/new", params);
  }

  public async sessionPrompt(params: SessionPromptParams): Promise<SessionPromptResult> {
    return this.request<SessionPromptResult>("session/prompt", params);
  }

  public async sessionCancel(params: SessionCancelParams): Promise<any> {
    this.notify("session/cancel", params);
    return { ok: true };
  }

  public async sessionClose(params: SessionCloseParams): Promise<any> {
    return this.request("session/close", params);
  }

  public onSessionUpdate(sessionId: string, listener: (update: any) => void): () => void {
    if (!this.sessionUpdateListeners.has(sessionId)) {
      this.sessionUpdateListeners.set(sessionId, new Set());
    }
    this.sessionUpdateListeners.get(sessionId)!.add(listener);
    return () => {
      this.sessionUpdateListeners.get(sessionId)?.delete(listener);
    };
  }

  public onOAuthUrl(listener: (url: string) => void): () => void {
    this.oauthUrlListeners.add(listener);
    return () => {
      this.oauthUrlListeners.delete(listener);
    };
  }

  public onExit(listener: (code: number | null) => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  public async stop(): Promise<void> {
    this.isShuttingDown = true;
    if (this.proc) {
      const pid = this.proc.pid;
      try {
        this.proc.kill();
      } catch {}
      if (process.platform === "win32" && pid) {
        try {
          Bun.spawnSync(["taskkill", "/F", "/T", "/PID", String(pid)]);
        } catch {}
      }
    }
    this.proc = null;
    this.isStarted = false;
  }
}
