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
import * as path from "node:path";

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

    // Track this instance's PyInstaller _MEI extraction dir in the background
    // (non-blocking): needed for crash-proof cleanup by the MEI watchdog.
    this.trackMeiDir();

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
    const proc = this.proc;
    if (!proc) return;
    const pid = proc.pid;

    // 1) Graceful shutdown: close stdin. The official ACP server detects EOF,
    //    tears down its sessions itself and exits normally, which lets the
    //    PyInstaller bootloader cleanup hook delete its _MEI extraction dir.
    try {
      const stdin: any = proc.stdin;
      if (stdin && typeof stdin.end === "function") stdin.end();
      else if (stdin && typeof stdin.close === "function") stdin.close();
    } catch {}

    // 2) Wait for the process to terminate on its own.
    const exited = await this.waitForExit(8000);

    // 3) Last resort only: force-kill the whole tree. This path leaks one
    //    _MEI dir, which the sweeper in server/index.ts removes on next start.
    if (!exited) {
      if (process.platform === "win32" && pid) {
        try {
          Bun.spawnSync(["taskkill", "/F", "/T", "/PID", String(pid)]);
        } catch {}
      } else {
        try {
          proc.kill();
        } catch {}
      }
    }
    this.proc = null;
    this.isStarted = false;
    this.cleanupMeiDir(pid);
  }

  // --- PyInstaller _MEI tracking (crash-proof cleanup support) ---

  private meiDir: string | null = null;

  private meiBaseDir(): string {
    return this.options.pyTempDir || process.env.TEMP || process.env.TMP || "";
  }

  private meiRegistryPath(): string {
    return path.join(this.meiBaseDir(), "mei-registry.json");
  }

  /** Background task: detect the _MEI dir this spawn extracted and register it. */
  private trackMeiDir(): void {
    const base = this.meiBaseDir();
    const proc = this.proc;
    if (!base || !proc) return;
    let before = new Set<string>();
    try {
      before = new Set(fs.readdirSync(base).filter((e) => e.startsWith("_MEI")));
    } catch {}
    const pid = proc.pid;
    (async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (!this.proc || this.proc.pid !== pid) return;
        try {
          for (const d of fs.readdirSync(base)) {
            if (d.startsWith("_MEI") && !before.has(d)) {
              this.meiDir = path.join(base, d);
              this.addRegistryEntry(pid, this.meiDir);
              return;
            }
          }
        } catch {}
      }
    })().catch(() => {});
  }

  private addRegistryEntry(pid: number, dir: string): void {
    const reg = this.meiRegistryPath();
    try {
      let arr: any[] = [];
      try { arr = JSON.parse(fs.readFileSync(reg, "utf8")); if (!Array.isArray(arr)) arr = []; } catch {}
      arr = arr.filter((e) => e && e.pid !== pid);
      arr.push({ pid, dir, startedAt: Date.now() });
      fs.writeFileSync(reg, JSON.stringify(arr, null, 2));
    } catch {}
  }

  /** Best-effort removal of our own _MEI dir (graceful exit usually already did it). */
  private cleanupMeiDir(pid?: number): void {
    if (this.meiDir) {
      try { fs.rmSync(this.meiDir, { recursive: true, force: true }); } catch {}
      this.meiDir = null;
    }
    if (pid === undefined) return;
    const reg = this.meiRegistryPath();
    try {
      const arr = JSON.parse(fs.readFileSync(reg, "utf8"));
      if (Array.isArray(arr)) {
        fs.writeFileSync(reg, JSON.stringify(arr.filter((e) => e?.pid !== pid), null, 2));
      }
    } catch {}
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    const proc = this.proc;
    if (!proc) return true;
    if (proc.exitCode !== null && proc.exitCode !== undefined) return true;
    try {
      await Promise.race([
        proc.exited,
        new Promise((r) => setTimeout(r, timeoutMs)),
      ]);
      return proc.exitCode !== null && proc.exitCode !== undefined;
    } catch {
      return false;
    }
  }
}
