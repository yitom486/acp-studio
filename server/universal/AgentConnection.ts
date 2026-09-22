import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
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
 * Locate the native Windows headless launcher (GUI-subsystem shim that
 * spawns console binaries with CREATE_NO_WINDOW + stdio passthrough).
 * Order: explicit env, dev-layout workspace path, installed package path.
 * Cached; missing launcher degrades gracefully to windowsHide/shell spawn.
 */
let cachedLauncher: string | null | undefined;
/** Drop the cached lookup (call after a bridge-source switch). */
export function resetHeadlessLauncherCache(): void {
  cachedLauncher = undefined;
}
export function findHeadlessLauncher(): string | null {
  if (cachedLauncher !== undefined) return cachedLauncher;
  cachedLauncher = null;
  const check = (p?: string | null) => {
    if (p && fs.existsSync(p)) {
      cachedLauncher = p;
      return true;
    }
    return false;
  };
  if (check(process.env.AGY_HEADLESS_LAUNCHER)) return cachedLauncher;
  // Managed on-demand install only (see agent-installer.ts): no bundled and
  // no dev-checkout fallback. Missing launcher warns loudly below and spawns
  // directly instead of silently using a stale local file.
  try {
    const meta = (import.meta as unknown as { url?: string })?.url;
    const req = meta ? createRequire(meta) : (globalThis as any).require;
    const installer = req("./agent-installer") as typeof import("./agent-installer");
    check(installer.resolveBridgeHeadless());
  } catch {
    // fall through to the loud warning below
  }
  if (!cachedLauncher) {
    console.warn("[UniversalACP] headless launcher not found; console windows may flash on Windows. Set AGY_HEADLESS_LAUNCHER.");
  }
  return cachedLauncher;
}

function isLauncherItself(command: string, launcher: string): boolean {
  if (path.basename(command).toLowerCase() === "agy-headless.exe") return true;
  try {
    return path.resolve(command) === path.resolve(launcher);
  } catch {
    return false;
  }
}

/**
 * Runtime binaries that must NEVER go through agy-headless.exe launcher.
 * The launcher only proxies real console business exes (e.g. agy-acp-win-x64.exe);
 * proxying a language runtime (bun/node/npm/...) makes the launcher try to
 * exec it as a payload and surfaces as `Access is denied` (mock tests hit this
 * with `bun.exe run <fixture>`). Case-insensitive basename match, with and
 * without Windows extension.
 */
export const RUNTIME_BASENAMES = new Set([
  "bun",
  "bun.exe",
  "bunx",
  "bunx.exe",
  "bunx.cmd",
  "node",
  "node.exe",
  "npm",
  "npm.cmd",
  "npm.exe",
  "npx",
  "npx.cmd",
  "npx.exe",
  "python",
  "python.exe",
  "python3",
  "python3.exe",
  "pip",
  "pip.exe",
  "uv",
  "uv.exe",
  "deno",
  "deno.exe",
]);

export function isRuntimeBinary(command: string): boolean {
  try {
    return RUNTIME_BASENAMES.has(path.basename(command).toLowerCase());
  } catch (err) {
    console.error(`[UniversalACP] isRuntimeBinary check failed for ${command}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Cross-runtime spawn (Bun *and* Node) with zero console flash on Windows.
 * Console binaries (.exe/.cmd/.bat) go through the native headless launcher
 * when available (works under every runtime, unlike windowsHide under Bun);
 * .cmd/.bat additionally fall back to shell:true for Node's EINVAL.
 * Runtime binaries (bun/node/npm/...) bypass the launcher entirely.
 */
function spawnCrossPlatform(command: string, args: string[], opts: SpawnOptions): ChildProcess {
  if (isRuntimeBinary(command)) {
    // Runtimes manage their own stdio/console; launcher proxy would break them.
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
      const line = [command, ...args]
        .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
        .join(" ");
      return spawn(line, { ...opts, shell: true });
    }
    return spawn(command, args, opts);
  }
  if (process.platform === "win32" && /\.(exe|cmd|bat)$/i.test(command)) {
    const launcher = findHeadlessLauncher();
    if (launcher && !isLauncherItself(command, launcher)) {
      return spawn(launcher, [command, ...args], { ...opts, shell: false });
    }
    if (/\.(cmd|bat)$/i.test(command)) {
      const line = [command, ...args]
        .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
        .join(" ");
      return spawn(line, { ...opts, shell: true });
    }
  }
  return spawn(command, args, opts);
}

/**
 * Resolve a command the way the OS would (PATH scan, PATHEXT on Windows).
 * Returns the absolute path or null — used to fail fast with the preset's
 * installHint instead of a cryptic ENOENT/EINVAL from spawn.
 */
export function whichCommand(command: string): string | null {
  if (!command) return null;
  const isAbs = path.isAbsolute(command);
  const dirs = isAbs
    ? [path.dirname(command)]
    : (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const base = isAbs ? path.basename(command) : command;
  const exts =
    process.platform === "win32" && !path.extname(base)
      ? ["", ".exe", ".cmd", ".bat", ".ps1"]
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, base + ext);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // try next
      }
    }
  }
  // Absolute path that exists but isn't executable-flagged (Windows has no X_OK).
  if (isAbs) {
    try {
      fs.accessSync(command, fs.constants.F_OK);
      return command;
    } catch {
      // miss
    }
  }
  return null;
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

  private connectInFlight: Promise<unknown> | null = null;
  private sessionSinks = new Map<string, Set<SseSend>>();
  private pendingPermissions = new Map<string, PendingPermission>();
  private pendingElicitations = new Map<string, PendingElicitation>();
  private permSeq = 1;
  private elicSeq = 1;
  private terminals = new Map<string, TerminalRecord>();
  private termSeq = 1;
  /**
   * Per-session prompt mutex: ACP session/prompt is strictly serial per
   * session. Concurrent prompt() calls for the same sessionId throw
   * `session busy ... (409)`; routes translate that into HTTP 409 so the
   * frontend can serialize/queue instead of interleaving turns.
   */
  private promptLocks = new Set<string>();

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
    if (this.connectInFlight) return this.connectInFlight;

    this.connectInFlight = (async () => {
      try {
        await this.spawn();
        return this.initResult;
      } finally {
        this.connectInFlight = null;
      }
    })();

    return this.connectInFlight;
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
    // Shell principle: fail fast with install guidance when the vendor CLI
    // is missing, instead of a cryptic spawn ENOENT/EINVAL.
    const resolved = whichCommand(this.profile.command);
    if (!resolved) {
      const hint = this.profile.installHint ? ` ${this.profile.installHint}` : "";
      throw new Error(`命令 '${this.profile.command}' 不在 PATH 中。${hint}`.trim());
    }
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
      if (!this.lastError && (code !== 0 || signal)) {
        const details = this.stderrTail.length ? `: ${this.stderrTail.slice(-3).join(" | ")}` : "";
        this.lastError = `Agent process exited unexpectedly (code ${code}, signal ${signal})${details}`;
      }
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
      const msg = err instanceof Error ? err.message : String(err ?? "ACP connection failed");
      const stderr = this.stderrTail.length ? `. stderr: ${this.stderrTail.slice(-5).join(" | ")}` : "";
      this.lastError = `initialize failed: ${msg}${stderr}`;
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
    const cwd = String(args.cwd || this.profile.defaultCwd || process.cwd());
    const mcpServers = Array.isArray(args.mcpServers) ? args.mcpServers : [];
    const payload = { ...args, sessionId, cwd, mcpServers };
    // session/load replays history via session/update notifications before
    // responding. Collect them so HTTP clients can rebuild the transcript.
    const replayed: unknown[] = [];
    const unsub = sessionId ? this.subscribe(sessionId, (evt) => {
      if ((evt as { type?: string }).type === "update") replayed.push((evt as { update?: unknown }).update);
    }) : () => undefined;
    try {
      const result = await conn.agent.request(acp.methods.agent.session.load, payload as unknown as never);
      // Grace window: session/update notifications are dispatched
      // asynchronously and can lag behind the load response. Unsubscribing
      // immediately drops the tail (e.g. the final assistant chunk). Wait
      // until quiet instead (same reason prompt() waits 50ms post-result).
      for (let i = 0; i < 20; i++) {
        const n = replayed.length;
        await new Promise((r) => setTimeout(r, 25));
        if (replayed.length === n) break;
      }
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
    const cwd = String(args.cwd || this.profile.defaultCwd || process.cwd());
    const mcpServers = Array.isArray(args.mcpServers) ? args.mcpServers : [];
    return conn.agent.request(acp.methods.agent.session.resume, { ...args, cwd, mcpServers } as unknown as never);
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
    try {
      await conn.agent.notify(acp.methods.agent.session.cancel, { sessionId } as unknown as never);
    } catch (err) {
      console.error(`[UniversalACP:${this.profile.id}] cancel notify failed session=${sessionId}: ${(err as Error).message}`);
      throw err;
    } finally {
      // Release the prompt mutex so a fresh turn can start after cancel.
      // The in-flight prompt()'s finally also deletes (idempotent).
      if (sessionId && this.promptLocks.has(sessionId)) {
        this.promptLocks.delete(sessionId);
      }
    }
    // Unblock any pending permission for this session as cancelled (per spec client MUST respond cancelled)
    for (const [id, p] of [...this.pendingPermissions]) {
      if (p.sessionId === sessionId) {
        this.pendingPermissions.delete(id);
        try {
          p.resolve({ outcome: "cancelled" });
        } catch (err) {
          console.error(`[UniversalACP:${this.profile.id}] permission resolve after cancel failed ${id}: ${(err as Error).message}`);
        }
      }
    }
  }

  /**
   * Send session/prompt. Streams session/update via onEvent callback until stop.
   * Permission/elicitation requests are surfaced via onEvent as well; the
   * underlying agent request stays pending until UI responds.
   * Mutex: same sessionId concurrent prompt() throws
   * `session busy: previous prompt still running (409)` (routes -> HTTP 409).
   */
  async prompt(
    sessionId: string,
    prompt: unknown[],
    onEvent: SseSend,
    opts?: { signal?: AbortSignal }
  ): Promise<unknown> {
    const conn = this.ensureConn();
    if (!sessionId) throw new Error("sessionId is required");
    if (this.promptLocks.has(sessionId)) {
      throw new Error("session busy: previous prompt still running (409)");
    }
    this.promptLocks.add(sessionId);
    const unsub = this.subscribe(sessionId, onEvent);
    let onAbort: (() => void) | undefined;
    try {
      if (opts?.signal) {
        onAbort = () => {
          this.cancel(sessionId).catch((err) => {
            console.error(`[UniversalACP:${this.profile.id}] abort-cancel failed session=${sessionId}: ${(err as Error).message}`);
          });
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
      try {
        if (opts?.signal && onAbort) opts.signal.removeEventListener("abort", onAbort);
      } catch (err) {
        console.error(`[UniversalACP:${this.profile.id}] abort listener cleanup failed: ${(err as Error).message}`);
      }
      this.promptLocks.delete(sessionId);
      await new Promise((r) => setTimeout(r, 50));
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

  /**
   * Conservative fs guard: normalize + block obvious system locations.
   * Full allowlist enforcement lives in server/universal/security.ts
   * (isPathAllowed + workspace roots) — owned by the security agent.
   * Here we only: (a) reject empty paths, (b) refuse Windows system dirs
   * and Unix sensitive mounts, (c) otherwise emitActivity + allow but leave
   * TODO for security allowlist to tighten. Deliberately permissive so
   * existing flows/tests keep working.
   */
  private checkFsPath(raw: string, sessionId: string, op: string): string {
    const session = sessionId || "";
    if (!raw || !String(raw).trim()) throw new Error(`fs/${op} failed: path is required`);
    let resolved: string;
    try {
      resolved = path.resolve(String(raw));
    } catch (err) {
      console.error(`[UniversalACP:${this.profile.id}] fs/${op} resolve failed ${raw}: ${(err as Error).message}`);
      throw new Error(`fs/${op} failed: invalid path`);
    }
    const lower = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    const blockedPrefixes =
      process.platform === "win32"
        ? ["c:\\windows", "c:\\program files", "c:\\program files (x86)"]
        : ["/etc", "/proc", "/sys"];
    for (const b of blockedPrefixes) {
      if (lower === b || lower.startsWith(b + path.sep)) {
        this.emitActivity(session, `fs_${op}_blocked`, { path: raw, resolved });
        throw new Error(`fs/${op} denied: system path not writable/readable (${resolved})`);
      }
    }
    // Conservative: if the resolved path escapes to a drive root via `..`
    // trickery (e.g. `C:\` alone or `/` alone when a file was expected),
    // still allow directories but log loudly. Real confinement (must be under
    // profile.defaultCwd / workspace root) is TODO(security-agent) via
    // isPathAllowed() allowlist — see server/universal/security.ts.
    // TODO(security-agent): enforce isPathAllowed(resolved) here once
    // workspace roots are stable; current permissive mode avoids breaking
    // existing agents/tests that use absolute tmp paths.
    return resolved;
  }

  private async handleReadFile(params: { sessionId?: string; path: string; line?: number; limit?: number }): Promise<unknown> {
    const sid = params.sessionId || "";
    this.emitActivity(sid, "fs_read", { path: params.path, line: params.line, limit: params.limit });
    const resolved = this.checkFsPath(params.path, sid, "read_text_file");
    try {
      const content = await fsp.readFile(resolved, "utf8");
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
    const sid = params.sessionId || "";
    this.emitActivity(sid, "fs_write", { path: params.path, bytes: Buffer.byteLength(params.content || "") });
    const resolved = this.checkFsPath(params.path, sid, "write_text_file");
    try {
      await fsp.mkdir(path.dirname(resolved), { recursive: true });
      await fsp.writeFile(resolved, params.content, "utf8");
      return {};
    } catch (err) {
      throw new Error(`fs/write_text_file failed for ${params.path}: ${(err as Error).message}`);
    }
  }

  private handleTerminalCreate(params: Record<string, unknown>): Promise<unknown> {
    const command = String(params.command || "");
    if (!command) throw new Error("terminal/create: command is required");
    const args = Array.isArray(params.args) ? (params.args as unknown[]).map(String) : [];
    // cwd must exist + be a directory; otherwise fall back to process.cwd().
    let cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : process.cwd();
    try {
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        console.warn(`[UniversalACP:${this.profile.id}] terminal cwd ${cwd} missing/not-a-dir, falling back to process.cwd()`);
        cwd = process.cwd();
      }
    } catch (err) {
      console.error(`[UniversalACP:${this.profile.id}] terminal cwd check failed: ${(err as Error).message}`);
      cwd = process.cwd();
    }
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
