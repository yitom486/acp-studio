import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentProfile, PendingElicitation, PendingPermission } from "./types";

export type SseSend = (evt: Record<string, unknown>) => void;

interface TerminalRecord {
  id: string;
  proc: ChildProcess;
  output: string;
  outputBytes: number;
  exited?: { code: number | null; signal: string | null };
  cwd: string;
}

/**
 * Cross-runtime spawn (Bun *and* Node).
 * Node on Windows cannot exec .cmd/.bat directly (EINVAL) — route those
 * through the shell with proper quoting. Bun tolerates both forms.
 */
function spawnCrossPlatform(command: string, args: string[], opts: SpawnOptions): ChildProcess {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const line = [command, ...args]
      .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
      .join(" ");
    return spawn(line, { ...opts, shell: true });
  }
  return spawn(command, args, opts);
}

/**
 * One long-lived stdio connection to a generic ACP agent.
 * Uses @agentclientprotocol/sdk `client().connect(stream)` (persistent),
 * implements full client-side surface: permission (forward to UI),
 * fs/read+write (real fs), terminal/* (real processes), elicitation (forward to UI).
 */
export class UniversalAgentConnection {
  readonly profile: AgentProfile;
  private proc: ChildProcess | null = null;
  private conn: acp.ClientConnection | null = null;
  private initResult: acp.InitializeResponse | null = null;
  private startedAt: string | null = null;
  private lastError: string | null = null;
  private stderrTail: string[] = [];

  private sessionSinks = new Map<string, Set<SseSend>>();
  private pendingPermissions = new Map<string, PendingPermission>();
  private pendingElicitations = new Map<string, PendingElicitation>();
  private permSeq = 1;
  private elicSeq = 1;
  private terminals = new Map<string, TerminalRecord>();
  private termSeq = 1;

  constructor(profile: AgentProfile) {
    this.profile = profile;
  }

  get connected(): boolean {
    return !!this.conn && !!this.proc && this.proc.exitCode === null && !(this.proc.killed ?? false);
  }

  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  status() {
    const init = this.initResult as unknown as {
      protocolVersion?: number;
      agentInfo?: unknown;
      agentCapabilities?: Record<string, unknown> | null;
      authMethods?: unknown;
      _meta?: Record<string, unknown> | null;
    } | null;
    // codex puts authStatus under agentCapabilities._meta, others (if any)
    // under top-level _meta — check both.
    const capsMeta = (init?.agentCapabilities as Record<string, unknown> | null | undefined)?._meta as
      | Record<string, unknown>
      | undefined;
    return {
      id: this.profile.id,
      connected: this.connected,
      pid: this.pid,
      protocolVersion: init?.protocolVersion ?? null,
      agentInfo: init?.agentInfo ?? null,
      agentCapabilities: init?.agentCapabilities ?? null,
      authMethods: init?.authMethods ?? null,
      // Raw `_meta` from initialize (e.g. codex steering/goal/jetbrains), plus
      // a convenience alias so clients don't need to dig into `_meta`.
      authStatus: (init?._meta as Record<string, unknown> | undefined)?.authStatus ?? capsMeta?.authStatus ?? null,
      meta: init?._meta ?? null,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  getInitResult(): acp.InitializeResponse | null {
    return this.initResult;
  }

  subscribe(sessionId: string, send: SseSend): () => void {
    let set = this.sessionSinks.get(sessionId);
    if (!set) {
      set = new Set();
      this.sessionSinks.set(sessionId, set);
    }
    set.add(send);
    return () => {
      set!.delete(send);
      if (set!.size === 0) this.sessionSinks.delete(sessionId);
    };
  }

  private broadcast(sessionId: string, evt: Record<string, unknown>) {
    const set = this.sessionSinks.get(sessionId);
    if (set) {
      for (const send of set) {
        try {
          send(evt);
        } catch {
          // ignore closed sinks
        }
      }
    }
  }

  listPendingPermissions(sessionId?: string) {
    return [...this.pendingPermissions.values()]
      .filter((p) => !sessionId || p.sessionId === sessionId)
      .map((p) => ({
        permissionId: p.permissionId,
        agentId: p.agentId,
        sessionId: p.sessionId,
        toolCall: p.toolCall,
        options: p.options,
        createdAt: p.createdAt,
      }));
  }

  listPendingElicitations(sessionId?: string) {
    return [...this.pendingElicitations.values()]
      .filter((p) => !sessionId || p.sessionId === sessionId)
      .map((p) => ({
        elicitationId: p.elicitationId,
        agentId: p.agentId,
        sessionId: p.sessionId,
        message: p.message,
        schema: p.schema,
        createdAt: p.createdAt,
      }));
  }

  resolvePermission(permissionId: string, outcome: unknown): boolean {
    const p = this.pendingPermissions.get(permissionId);
    if (!p) return false;
    this.pendingPermissions.delete(permissionId);
    p.resolve(outcome);
    return true;
  }

  resolveElicitation(elicitationId: string, result: unknown): boolean {
    const p = this.pendingElicitations.get(elicitationId);
    if (!p) return false;
    this.pendingElicitations.delete(elicitationId);
    p.resolve(result);
    return true;
  }

  async connect(): Promise<unknown> {
    if (this.connected && this.initResult) return this.initResult;
    await this.spawn();
    return this.initResult;
  }

  private async spawn(): Promise<void> {
    await this.disconnect().catch(() => undefined);
    this.lastError = null;
    this.stderrTail = [];

    const env = { ...process.env, ...(this.profile.env || {}) } as Record<string, string>;
    // Ensure NO_PROXY for localhost so local MCP/servers never go through proxy
    env.NO_PROXY = env.NO_PROXY || "localhost,127.0.0.1,::1";
    env.no_proxy = env.no_proxy || "localhost,127.0.0.1,::1";

    const cwd = this.profile.defaultCwd && fs.existsSync(this.profile.defaultCwd) ? this.profile.defaultCwd : process.cwd();
    console.log(`[UniversalACP:${this.profile.id}] spawn: ${this.profile.command} ${(this.profile.args || []).join(" ")}`);

    const proc = spawnCrossPlatform(this.profile.command, this.profile.args || [], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc = proc;
    this.startedAt = new Date().toISOString();

    proc.on("error", (err) => {
      this.lastError = `spawn error: ${(err as Error).message}`;
      console.error(`[UniversalACP:${this.profile.id}]`, this.lastError);
    });
    proc.on("exit", (code, signal) => {
      console.warn(`[UniversalACP:${this.profile.id}] exited code=${code} signal=${signal} stderrTail=${this.stderrTail.slice(-3).join(" | ")}`);
      // Fail pending permission/elicitation so prompt turns don't hang forever
      for (const [id, p] of this.pendingPermissions) {
        this.pendingPermissions.delete(id);
        p.reject(new Error(`Agent exited (code ${code}) while permission ${id} pending`));
      }
      for (const [id, p] of this.pendingElicitations) {
        this.pendingElicitations.delete(id);
        p.reject(new Error(`Agent exited (code ${code}) while elicitation ${id} pending`));
      }
      this.conn = null;
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        this.stderrTail.push(t);
        if (this.stderrTail.length > 50) this.stderrTail.shift();
      }
      // Keep agent logs visible but clearly tagged
      process.stderr.write(`[ACP:${this.profile.id}] ${text}`);
    });

    if (!proc.stdin || !proc.stdout) {
      throw new Error(`Failed to open stdio pipes for ${this.profile.id}`);
    }

    const toWebWritable = Writable.toWeb(proc.stdin) as unknown as WritableStream<Uint8Array>;
    const toWebReadable = Readable.toWeb(proc.stdout) as unknown as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(toWebWritable, toWebReadable);

    const self = this;
    const app = acp
      .client({ name: "acp-studio-universal" })
      .onRequest(acp.methods.client.session.requestPermission, async (ctx: unknown) => {
        const params = (ctx as { params: { sessionId: string; toolCall: unknown; options: unknown } }).params;
        return (await self.handlePermissionRequest(params)) as never;
      })
      .onRequest(acp.methods.client.fs.readTextFile, async (ctx: unknown) => {
        const params = (ctx as { params: { sessionId?: string; path: string; line?: number; limit?: number } }).params;
        return (await self.handleReadFile(params)) as never;
      })
      .onRequest(acp.methods.client.fs.writeTextFile, async (ctx: unknown) => {
        const params = (ctx as { params: { sessionId?: string; path: string; content: string } }).params;
        return (await self.handleWriteFile(params)) as never;
      })
      .onRequest(acp.methods.client.terminal.create, async (ctx: unknown) => {
        const params = (ctx as { params: Record<string, unknown> }).params;
        return (await self.handleTerminalCreate(params)) as never;
      })
      .onRequest(acp.methods.client.terminal.output, async (ctx: unknown) => {
        const params = (ctx as { params: { terminalId: string } }).params;
        return (await self.handleTerminalOutput(params)) as never;
      })
      .onRequest(acp.methods.client.terminal.release, async (ctx: unknown) => {
        const params = (ctx as { params: { sessionId?: string; terminalId: string } }).params;
        return (await self.handleTerminalRelease(params)) as never;
      })
      .onRequest(acp.methods.client.terminal.waitForExit, async (ctx: unknown) => {
        const params = (ctx as { params: { sessionId?: string; terminalId: string } }).params;
        return (await self.handleTerminalWait(params)) as never;
      })
      .onRequest(acp.methods.client.terminal.kill, async (ctx: unknown) => {
        const params = (ctx as { params: { sessionId?: string; terminalId: string } }).params;
        return (await self.handleTerminalKill(params)) as never;
      })
      .onRequest(acp.methods.client.elicitation.create, async (ctx: unknown) => {
        const params = (ctx as { params: Record<string, unknown> }).params;
        return (await self.handleElicitation(params)) as never;
      })
      .onNotification(acp.methods.client.session.update, async (ctx: unknown) => {
        const params = (ctx as { params: { sessionId: string; update: Record<string, unknown> } }).params;
        self.broadcast(params.sessionId, {
          type: "update",
          agentId: self.profile.id,
          sessionId: params.sessionId,
          update: params.update,
        });
      })
      .onNotification(acp.methods.client.elicitation.complete, async () => {
        // URL elicitation completed out-of-band; surface as activity so UI can refresh
      });

    this.conn = app.connect(stream);

    // initialize handshake with full client capabilities (ACP v1)
    try {
      const res = await this.conn.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
          auth: { terminal: true },
          elicitation: { form: {}, url: {} },
          // advertise boolean config options + session lang support where SDK allows passthrough
          session: { configOptions: { boolean: {} } },
        },
        clientInfo: { name: "acp-studio-universal", title: "ACP Studio Universal", version: "1.0.0" },
      } as unknown as never);
      this.initResult = res as unknown as acp.InitializeResponse;
      console.log(
        `[UniversalACP:${this.profile.id}] initialize ok protocol=${(this.initResult as unknown as { protocolVersion?: number }).protocolVersion}`
      );
    } catch (err) {
      this.lastError = `initialize failed: ${(err as Error).message}. stderr: ${this.stderrTail.slice(-5).join(" | ")}`;
      console.error(`[UniversalACP:${this.profile.id}]`, this.lastError);
      await this.disconnect().catch(() => undefined);
      throw new Error(this.lastError);
    }
  }

  async disconnect(): Promise<void> {
    const proc = this.proc;
    this.conn = null;
    this.initResult = null;
    if (proc) {
      this.proc = null;
      try {
        if (proc.stdin) (proc.stdin as unknown as { end?: () => void }).end?.();
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        proc.once("exit", finish);
        setTimeout(() => {
          try {
            proc.kill();
          } catch {
            // ignore
          }
          finish();
        }, 3000);
      }).catch(() => undefined);
    }
    // kill terminals owned by this connection
    for (const [, t] of this.terminals) {
      try {
        t.proc.kill();
      } catch {
        // ignore
      }
    }
    this.terminals.clear();
  }

  private ensureConn(): acp.ClientConnection {
    if (!this.conn) throw new Error(`Agent '${this.profile.id}' not connected. Call connect first.`);
    return this.conn;
  }

  // ---------- agent passthrough methods ----------
  async authenticate(methodId: string, extra?: Record<string, unknown>): Promise<unknown> {
    const conn = this.ensureConn();
    return conn.agent.request(acp.methods.agent.authenticate, { methodId, ...(extra || {}) } as unknown as never);
  }

  async logout(): Promise<unknown> {
    const conn = this.ensureConn();
    const caps = (this.initResult as unknown as { agentCapabilities?: { auth?: { logout?: unknown } } })?.agentCapabilities;
    if (!caps?.auth?.logout) throw new Error("Agent does not advertise auth.logout");
    return conn.agent.request(acp.methods.agent.logout, {} as unknown as never);
  }

  async newSession(args: { cwd?: string; mcpServers?: unknown[]; additionalDirectories?: string[] }): Promise<unknown> {
    const conn = this.ensureConn();
    const cwd = args.cwd || this.profile.defaultCwd || process.cwd();
    return conn.agent.request(acp.methods.agent.session.new, {
      cwd,
      mcpServers: (args.mcpServers || []) as never[],
      ...(args.additionalDirectories ? { additionalDirectories: args.additionalDirectories } : {}),
    } as unknown as never);
  }

  async loadSession(args: Record<string, unknown>): Promise<{ result: unknown; replayed: unknown[] }> {
    const conn = this.ensureConn();
    const sessionId = String((args as { sessionId?: string }).sessionId || "");
    // session/load replays history via session/update notifications before
    // responding. Collect them so HTTP clients can rebuild the transcript.
    const replayed: unknown[] = [];
    const unsub = sessionId ? this.subscribe(sessionId, (evt) => {
      if ((evt as { type?: string }).type === "update") replayed.push((evt as { update?: unknown }).update);
    }) : () => undefined;
    try {
      const result = await conn.agent.request(acp.methods.agent.session.load, args as unknown as never);
      return { result, replayed };
    } finally {
      unsub();
    }
  }

  /** UNSTABLE session/fork (advertised via sessionCapabilities.fork, e.g. codex). */
  async forkSession(args: Record<string, unknown>): Promise<unknown> {
    const conn = this.ensureConn();
    return conn.agent.request(acp.methods.agent.session.fork, args as unknown as never);
  }

  /** UNSTABLE providers/* (advertised via providers capability, e.g. codex). */  async providersRpc(action: "list" | "set" | "disable", body: Record<string, unknown>): Promise<unknown> {
    const conn = this.ensureConn();
    const method =
      action === "list" ? acp.methods.agent.providers.list
      : action === "set" ? acp.methods.agent.providers.set
      : acp.methods.agent.providers.disable;
    return conn.agent.request(method, body as unknown as never);
  }

  /**
   * Escape hatch for legacy/unstable agent methods (e.g. session/set_model
   * on agy-style servers that lack session config options).
   */
  async rawRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const conn = this.ensureConn();
    return conn.agent.request(method as never, params as never);
  }

  /** Broadcast an fs/terminal/compaction activity line into session sinks. */
  private emitActivity(sessionId: string, kind: string, detail?: unknown) {
    if (!sessionId) return;
    this.broadcast(sessionId, { type: "activity", agentId: this.profile.id, sessionId, kind, detail });
  }

  async resumeSession(args: Record<string, unknown>): Promise<unknown> {
    const conn = this.ensureConn();
    return conn.agent.request(acp.methods.agent.session.resume, args as unknown as never);
  }

  async listSessions(args: Record<string, unknown> = {}): Promise<unknown> {
    const conn = this.ensureConn();
    return conn.agent.request(acp.methods.agent.session.list, args as unknown as never);
  }

  async deleteSession(args: Record<string, unknown>): Promise<unknown> {
    const conn = this.ensureConn();
    return conn.agent.request(acp.methods.agent.session.delete, args as unknown as never);
  }

  async closeSession(args: Record<string, unknown>): Promise<unknown> {
    const conn = this.ensureConn();
    const caps = (this.initResult as unknown as { agentCapabilities?: { sessionCapabilities?: { close?: unknown } } })?.agentCapabilities;
    if (!caps?.sessionCapabilities?.close) {
      // Best-effort: drop local sinks even if agent has no close
      const sid = String((args as { sessionId?: string }).sessionId || "");
      if (sid) this.sessionSinks.delete(sid);
      return {};
    }
    return conn.agent.request(acp.methods.agent.session.close, args as unknown as never);
  }

  async setMode(args: Record<string, unknown>): Promise<unknown> {
    const conn = this.ensureConn();
    return conn.agent.request(acp.methods.agent.session.setMode, args as unknown as never);
  }

  async setConfigOption(args: Record<string, unknown>): Promise<unknown> {
    const conn = this.ensureConn();
    // Normalize to SetSessionConfigOptionRequest shapes:
    // select -> {sessionId, configId, value: "<valueId>"} (value_id variant),
    // boolean -> {sessionId, configId, type: "boolean", value: bool}.
    const normalized: Record<string, unknown> = { ...args };
    if (typeof normalized.value === "boolean" && !normalized.type) {
      normalized.type = "boolean";
    }
    return conn.agent.request(acp.methods.agent.session.setConfigOption, normalized as unknown as never);
  }

  async cancel(sessionId: string): Promise<void> {
    const conn = this.ensureConn();
    await conn.agent.notify(acp.methods.agent.session.cancel, { sessionId } as unknown as never);
    // Unblock any pending permission for this session as cancelled (per spec client MUST respond cancelled)
    for (const [id, p] of [...this.pendingPermissions]) {
      if (p.sessionId === sessionId) {
        this.pendingPermissions.delete(id);
        p.resolve({ outcome: "cancelled" });
      }
    }
  }

  /**
   * Send session/prompt. Streams session/update via onEvent callback until stop.
   * Permission/elicitation requests are surfaced via onEvent as well; the
   * underlying agent request stays pending until UI responds.
   */
  async prompt(
    sessionId: string,
    prompt: unknown[],
    onEvent: SseSend,
    opts?: { signal?: AbortSignal }
  ): Promise<unknown> {
    const conn = this.ensureConn();
    const unsub = this.subscribe(sessionId, onEvent);
    let onAbort: (() => void) | undefined;
    try {
      if (opts?.signal) {
        onAbort = () => {
          this.cancel(sessionId).catch(() => undefined);
        };
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      const res = await conn.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt,
      } as unknown as never);
      return res;
    } finally {
      if (opts?.signal && onAbort) opts.signal.removeEventListener("abort", onAbort);
      unsub();
    }
  }

  // ---------- client-side handlers ----------
  private handlePermissionRequest(params: { sessionId: string; toolCall: unknown; options: unknown }): Promise<unknown> {
    const permissionId = `perm-${Date.now()}-${this.permSeq++}`;
    console.log(`[UniversalACP:${this.profile.id}] permission request ${permissionId} session=${params.sessionId}`);
    // Notify any active prompt SSE streams immediately
    this.broadcast(params.sessionId, {
      type: "permission_request",
      agentId: this.profile.id,
      sessionId: params.sessionId,
      permissionId,
      toolCall: params.toolCall,
      options: params.options,
    });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingPermissions.has(permissionId)) {
          this.pendingPermissions.delete(permissionId);
          reject(new Error("Permission request timed out after 180s"));
        }
      }, 180_000);
      const wrappedResolve = (outcome: unknown) => {
        clearTimeout(timer);
        // normalize UI payload -> ACP RequestPermissionResponse
        resolve(this.normalizePermissionOutcome(outcome));
      };
      this.pendingPermissions.set(permissionId, {
        permissionId,
        agentId: this.profile.id,
        sessionId: params.sessionId,
        toolCall: params.toolCall,
        options: params.options,
        createdAt: Date.now(),
        resolve: wrappedResolve,
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  private normalizePermissionOutcome(outcome: unknown): unknown {
    // UI sends {outcome:"selected",optionId} | {outcome:"cancelled"} | {optionId}
    if (outcome && typeof outcome === "object") {
      const o = outcome as Record<string, unknown>;
      if (o.outcome === "selected" || o.outcome === "cancelled") {
        if (o.outcome === "selected") return { outcome: { outcome: "selected", optionId: o.optionId } };
        return { outcome: { outcome: "cancelled" } };
      }
      if (typeof o.optionId === "string") return { outcome: { outcome: "selected", optionId: o.optionId } };
    }
    if (typeof outcome === "string") return { outcome: { outcome: "selected", optionId: outcome } };
    return { outcome: { outcome: "cancelled" } };
  }

  private async handleReadFile(params: { sessionId?: string; path: string; line?: number; limit?: number }): Promise<unknown> {
    this.emitActivity(params.sessionId || "", "fs_read", { path: params.path, line: params.line, limit: params.limit });
    try {
      const content = await fsp.readFile(params.path, "utf8");
      const lines = content.split("\n");
      if (params.line != null) {
        const start = Math.max(0, (params.line - 1));
        const end = params.limit != null ? start + params.limit : undefined;
        return { content: lines.slice(start, end).join("\n") };
      }
      return { content };
    } catch (err) {
      throw new Error(`fs/read_text_file failed for ${params.path}: ${(err as Error).message}`);
    }
  }

  private async handleWriteFile(params: { sessionId?: string; path: string; content: string }): Promise<unknown> {
    this.emitActivity(params.sessionId || "", "fs_write", { path: params.path, bytes: Buffer.byteLength(params.content || "") });
    try {
      await fsp.mkdir(path.dirname(params.path), { recursive: true });
      await fsp.writeFile(params.path, params.content, "utf8");
      return {};
    } catch (err) {
      throw new Error(`fs/write_text_file failed for ${params.path}: ${(err as Error).message}`);
    }
  }

  private handleTerminalCreate(params: Record<string, unknown>): Promise<unknown> {
    const command = String(params.command || "");
    if (!command) throw new Error("terminal/create: command is required");
    const args = Array.isArray(params.args) ? (params.args as unknown[]).map(String) : [];
    const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : process.cwd();
    const envList = Array.isArray(params.env) ? (params.env as Array<{ name: string; value: string }>) : [];
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const e of envList) {
      if (e && e.name) env[e.name] = String(e.value ?? "");
    }
    const outputByteLimit = typeof params.outputByteLimit === "number" ? params.outputByteLimit : 256 * 1024;
    const id = `term-${Date.now()}-${this.termSeq++}`;
    const sessionId = String(params.sessionId || "");
    this.emitActivity(sessionId, "terminal_create", { terminalId: id, command, args, cwd });
    const proc = spawnCrossPlatform(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
    const rec: TerminalRecord = { id, proc, output: "", outputBytes: 0, cwd };
    this.terminals.set(id, rec);
    const append = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      rec.output += text;
      rec.outputBytes += Buffer.byteLength(text);
      if (rec.outputBytes > outputByteLimit) {
        // truncate from beginning at char boundary
        const excess = rec.outputBytes - outputByteLimit;
        rec.output = rec.output.slice(Math.ceil(excess / 2));
        rec.outputBytes = Buffer.byteLength(rec.output);
      }
    };
    proc.stdout?.on("data", append);
    proc.stderr?.on("data", append);
    proc.on("exit", (code, signal) => {
      rec.exited = { code, signal: signal as string | null };
    });
    proc.on("error", (err) => {
      rec.output += `\n[terminal spawn error: ${(err as Error).message}]\n`;
      rec.exited = { code: 1, signal: null };
    });
    return Promise.resolve({ terminalId: id });
  }

  private async handleTerminalOutput(params: { terminalId: string }): Promise<unknown> {
    const rec = this.terminals.get(params.terminalId);
    if (!rec) throw new Error(`Unknown terminal ${params.terminalId}`);
    return { output: rec.output, exitStatus: rec.exited ? { code: rec.exited.code ?? 0 } : undefined };
  }

  private async handleTerminalRelease(params: { sessionId?: string; terminalId: string }): Promise<unknown> {
    this.emitActivity(params.sessionId || "", "terminal_release", { terminalId: params.terminalId });
    const rec = this.terminals.get(params.terminalId);
    if (rec) {
      this.terminals.delete(params.terminalId);
      try {
        rec.proc.kill();
      } catch {
        // ignore
      }
    }
    return {};
  }

  private async handleTerminalWait(params: { terminalId: string }): Promise<unknown> {
    const rec = this.terminals.get(params.terminalId);
    if (!rec) throw new Error(`Unknown terminal ${params.terminalId}`);
    if (rec.exited) return { code: rec.exited.code ?? 0 };
    const code = await new Promise<number>((resolve) => {
      rec.proc.once("exit", (c) => resolve(c ?? 0));
    });
    return { code };
  }

  private async handleTerminalKill(params: { sessionId?: string; terminalId: string }): Promise<unknown> {
    this.emitActivity(params.sessionId || "", "terminal_kill", { terminalId: params.terminalId });
    const rec = this.terminals.get(params.terminalId);
    if (!rec) throw new Error(`Unknown terminal ${params.terminalId}`);
    try {
      rec.proc.kill();
    } catch {
      // ignore
    }
    return {};
  }

  private handleElicitation(params: Record<string, unknown>): Promise<unknown> {
    const elicitationId = `elic-${Date.now()}-${this.elicSeq++}`;
    const sessionId = String((params as { sessionId?: string }).sessionId || "");
    const message = String((params as { message?: string }).message || "Input requested");
    console.log(`[UniversalACP:${this.profile.id}] elicitation ${elicitationId} session=${sessionId}`);
    if (sessionId) {
      this.broadcast(sessionId, {
        type: "elicitation_request",
        agentId: this.profile.id,
        sessionId,
        elicitationId,
        message,
        schema: params,
      });
    }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingElicitations.has(elicitationId)) {
          this.pendingElicitations.delete(elicitationId);
          reject(new Error("Elicitation timed out after 180s"));
        }
      }, 180_000);
      this.pendingElicitations.set(elicitationId, {
        elicitationId,
        agentId: this.profile.id,
        sessionId,
        message,
        schema: params,
        createdAt: Date.now(),
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  private assertCap(_name: string, _ok: unknown) {
    // Soft check: some agents omit caps but still implement the method; let server decide.
    return;
  }
}
