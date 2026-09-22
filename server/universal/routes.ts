import { universalRegistry } from "./registry";
import { isAuthRequiredError, acpErrorCode } from "./errors";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

/**
 * Optional security wiring (owned by security agent).
 * server/universal/security.ts may or may not exist — never hard-depend.
 * If present, gateway auth (requireGatewayAuth) is enforced; if missing or
 * import fails, requests are allowed through (open) so universal flows and
 * offline tests keep working.
 * TODO(security-agent): tighten to default-deny once token flow is stable.
 */
async function optionalGatewayAuth(req: Request): Promise<Response | null> {
  try {
    // @ts-ignore - optional module; tsc must not fail when missing.
    const sec = await import("./security");
    const fn = (sec as { requireGatewayAuth?: unknown; requireAuth?: unknown }).requireGatewayAuth
      ?? (sec as { requireAuth?: unknown }).requireAuth;
    if (typeof fn === "function") {
      try {
        const denied = (fn as (r: Request) => Response | null)(req);
        if (denied) return denied;
      } catch (err) {
        console.error(`[Universal] security auth check threw: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    // Missing module => open. Log loudly only for real load errors, not for
    // "module not found" in dev/test where security agent hasn't landed.
    const msg = (err as Error).message || String(err);
    if (!/Cannot find|Failed to resolve|ENOENT/i.test(msg)) {
      console.error(`[Universal] optional security import failed (open): ${msg}`);
    }
  }
  return null;
}

/**
 * Optional workspace allowlist check (security agent owned).
 * Returns true/false when security module exists, null when missing (skip).
 * TODO(security-agent): make this default-deny once ACP_WORKSPACE_ROOTS stable.
 */
async function optionalIsPathAllowed(p: string): Promise<boolean | null> {
  try {
    // @ts-ignore - optional module; tsc must not fail when missing.
    const sec = await import("./security");
    const fn = (sec as { isPathAllowed?: unknown }).isPathAllowed;
    if (typeof fn === "function") {
      try {
        return (fn as (x: string) => boolean)(p);
      } catch (err) {
        console.error(`[Universal] isPathAllowed threw for ${p}: ${(err as Error).message}`);
        return false;
      }
    }
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (!/Cannot find|Failed to resolve|ENOENT/i.test(msg)) {
      console.error(`[Universal] optional isPathAllowed import failed (skip): ${msg}`);
    }
  }
  return null;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders() });
}

/**
 * Workspace git inspection for the "view code changes" UI.
 * Same trust level as the fs/terminal client capabilities (local dev tool).
 * Guards: cwd must exist + be a git repo; file must stay inside cwd;
 * outputs are byte-capped.
 */
const GIT_MAX_BYTES = 300_000;

function runGit(cwd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: GIT_MAX_BYTES * 2,
      windowsHide: true,
    });
    if (r.error) return { ok: false, out: String(r.error.message || r.error) };
    const out = typeof r.stdout === "string" ? r.stdout : "";
    return { ok: r.status === 0, out: out.slice(0, GIT_MAX_BYTES) };
  } catch (err) {
    return { ok: false, out: (err as Error).message };
  }
}

function resolveRepo(cwd: string): { repo?: string; error?: string } {
  if (!cwd || !fs.existsSync(cwd)) return { error: "cwd 不存在" };
  const top = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.out.trim()) return { error: "该目录不是 git 仓库" };
  // Normalize Windows separators for reliable prefix checks.
  return { repo: path.normalize(top.out.trim()) };
}

export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
}

function parsePorcelain(out: string): GitFileChange[] {
  const changes: GitFileChange[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    // Format: XY SP path (rename: "old" -> "new")
    const x = line[0] || " ";
    const y = line[1] || " ";
    let p = line.slice(3).trim();
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4).trim();
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
      p = p.slice(1, -1);
    }
    const staged = x !== " " && x !== "?";
    const status = x === "?" ? "?" : (x !== " " ? x : y);
    changes.push({ path: p, status, staged });
  }
  return changes.slice(0, 500);
}

async function handleGit(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname;
  if (!p.startsWith("/api/universal/git/")) return null;

  if (p === "/api/universal/git/stage" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const cwd = String(body.cwd || "");
      const resolved = resolveRepo(cwd);
      if (!resolved.repo) return json({ ok: false, error: resolved.error }, 400);
      const repo = resolved.repo;
      const file = String(body.file || "");
      const abs = path.normalize(path.join(repo, file));
      if (!file || (abs !== repo && !abs.startsWith(repo + path.sep))) {
        return json({ ok: false, error: "file 必须位于仓库内" }, 400);
      }
      const rel = path.relative(repo, abs);
      const res = runGit(repo, ["add", "--", rel]);
      if (!res.ok) return json({ ok: false, error: res.out || "git add 失败" }, 500);
      return json({ ok: true });
    } catch (err: any) {
      return json({ ok: false, error: err.message || "git add 失败" }, 400);
    }
  }

  if (p === "/api/universal/git/restore" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const cwd = String(body.cwd || "");
      const resolved = resolveRepo(cwd);
      if (!resolved.repo) return json({ ok: false, error: resolved.error }, 400);
      const repo = resolved.repo;
      const file = String(body.file || "");
      const abs = path.normalize(path.join(repo, file));
      if (!file || (abs !== repo && !abs.startsWith(repo + path.sep))) {
        return json({ ok: false, error: "file 必须位于仓库内" }, 400);
      }
      const rel = path.relative(repo, abs);
      const res = runGit(repo, ["restore", "--", rel]);
      if (!res.ok) return json({ ok: false, error: res.out || "git restore 失败" }, 500);
      return json({ ok: true });
    } catch (err: any) {
      return json({ ok: false, error: err.message || "git restore 失败" }, 400);
    }
  }

  if (p !== "/api/universal/git/status" && p !== "/api/universal/git/file") return null;
  if (req.method !== "GET") return json({ ok: false, error: "method not allowed" }, 405);

  const cwd = url.searchParams.get("cwd") || "";
  const resolved = resolveRepo(cwd);
  if (!resolved.repo) return json({ ok: false, error: resolved.error }, 400);
  const repo = resolved.repo;

  if (p === "/api/universal/git/status") {
    const branch = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const porcelain = runGit(repo, ["status", "--porcelain=v1", "-uall"]);
    if (!porcelain.ok) return json({ ok: false, error: porcelain.out.slice(0, 300) || "git status 失败" }, 500);
    return json({
      ok: true,
      repo,
      branch: branch.ok ? branch.out.trim() : "",
      files: parsePorcelain(porcelain.out),
    });
  }

  // /api/universal/git/file?cwd=&file= : before (HEAD) + after (worktree) texts.
  const file = url.searchParams.get("file") || "";
  const abs = path.normalize(path.join(repo, file));
  if (!file || abs !== repo && !abs.startsWith(repo + path.sep)) {
    return json({ ok: false, error: "file 必须位于仓库内" }, 400);
  }
  const rel = path.relative(repo, abs);
  const numstat = runGit(repo, ["diff", "--numstat", "--", rel]);
  const binary = numstat.ok && numstat.out.split("\n").some((l) => l.startsWith("-\t-\t"));
  let before: string | null = null;
  let after: string | null = null;
  let unified: string | null = null;
  if (!binary) {
    const show = runGit(repo, ["show", `HEAD:${rel}`]);
    if (show.ok) before = show.out.slice(0, GIT_MAX_BYTES);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const buf = fs.readFileSync(abs);
        if (!buf.includes(0)) after = buf.toString("utf8").slice(0, GIT_MAX_BYTES);
      }
    } catch {
      after = null;
    }
    const diff = runGit(repo, ["diff", "HEAD", "--no-color", "-U3", "--", rel]);
    if (diff.ok && diff.out.trim()) unified = diff.out.slice(0, GIT_MAX_BYTES);
  }
  return json({
    ok: true,
    repo,
    file: rel,
    binary,
    truncated: (before?.length || 0) >= GIT_MAX_BYTES || (after?.length || 0) >= GIT_MAX_BYTES,
    before,
    after,
    unified,
  });
}

/**
 * Normalize an ACP/agent failure into a gateway error response.
 * Auth failures become 401 + authRequired so the UI can open the
 * auth flow without sniffing message text.
 */
export function gatewayErrorBody(err: unknown): { status: number; body: Record<string, unknown> } {
  const rawMsg = err instanceof Error ? err.message : String(err ?? "request failed");
  const message = (rawMsg && rawMsg !== "null" && rawMsg !== "undefined") ? rawMsg : "request failed";
  const code = acpErrorCode(err);
  const authRequired = isAuthRequiredError(err);
  return {
    status: authRequired ? 401 : 500,
    body: { ok: false, error: message, authRequired, ...(code !== null ? { code } : {}) },
  };
}

function gatewayError(err: unknown, prefix?: string): Response {
  const { status, body } = gatewayErrorBody(err);
  if (prefix) body.error = `${prefix}: ${body.error}`;
  return json(body, status);
}

/** Normalize frontend prompt into ACP ContentBlock[] */
function normalizePrompt(input: unknown): Array<Record<string, unknown>> {
  if (typeof input === "string") return [{ type: "text", text: input }];
  if (Array.isArray(input)) {
    return input.map((b) => {
      if (typeof b === "string") return { type: "text", text: b };
      if (b && typeof b === "object") return b as Record<string, unknown>;
      return { type: "text", text: String(b ?? "") };
    });
  }
  if (input && typeof input === "object") return [input as Record<string, unknown>];
  return [{ type: "text", text: String(input ?? "") }];
}

/**
 * Universal ACP gateway routes. Returns null when path is not universal.
 * Mount BEFORE legacy catch-all in server/index.ts.
 */
export async function handleUniversal(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const p = url.pathname;

  if (req.method === "OPTIONS" && p.startsWith("/api/universal")) {
    return new Response(null, { headers: corsHeaders() });
  }
  if (!p.startsWith("/api/universal")) return null;

  // Optional gateway auth (security agent owned; missing => open).
  try {
    const denied = await optionalGatewayAuth(req);
    if (denied) return denied;
  } catch (err) {
    console.error(`[Universal] optionalGatewayAuth failed (open): ${(err as Error).message}`);
  }

  // ---- agents ----
  if (p === "/api/universal/agents" && req.method === "GET") {
    const profiles = universalRegistry.listProfiles();
    const statuses = universalRegistry.statuses();
    const byId = new Map(statuses.map((s) => [s.id, s]));
    return json({
      ok: true,
      agents: profiles.map((pr) => ({ ...pr, status: byId.get(pr.id) || { connected: false } })),
    });
  }

  if (p === "/api/universal/agents" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const saved = universalRegistry.upsertProfile({
        id: String(body.id || ""),
        name: String(body.name || body.id || ""),
        title: String(body.title || body.id || ""),
        description: body.description as string | undefined,
        homepage: body.homepage as string | undefined,
        command: String(body.command || ""),
        args: Array.isArray(body.args) ? (body.args as unknown[]).map(String) : [],
        env: (body.env as Record<string, string>) || {},
        defaultCwd: body.defaultCwd as string | undefined,
        authHint: body.authHint as string | undefined,
        installHint: body.installHint as string | undefined,
      });
      return json({ ok: true, agent: saved });
    } catch (err) {
      return json({ ok: false, error: (err as Error).message }, 400);
    }
  }

  const agentMatch = p.match(/^\/api\/universal\/agents\/([^/]+)(\/.*)?$/);  if (agentMatch) {
    const agentId = decodeURIComponent(agentMatch[1]);
    const rest = agentMatch[2] || "";

    const getConn = () => universalRegistry.connFor(agentId);

    if (rest === "/connect" && req.method === "POST") {
      try {
        const conn = getConn();
        const init = await conn.connect();
        return json({ ok: true, status: conn.status(), init });
      } catch (err) {
        const st = getConn().status();
        const rawMsg = err instanceof Error ? err.message : String(err ?? "");
        const error = (rawMsg && rawMsg !== "null" && rawMsg !== "undefined") ? rawMsg : (st.lastError || "Agent connection failed");
        return json({ ok: false, error, status: st }, 500);
      }
    }

    if (rest === "/disconnect" && req.method === "POST") {
      try {
        await getConn().disconnect();
      } catch (err) {
        console.error(`[Universal] disconnect failed ${agentId}: ${(err as Error).message}`);
      }
      return json({ ok: true, status: getConn().status() });
    }

    if (rest === "/sessions/empty" && req.method === "DELETE") {
      // One-click cleanup of abandoned empty sessions. Strict and loud:
      // only rows the agent marks as turn-less AND old AND unbound are
      // deleted; every skip/failure is reported, never silently swallowed.
      // Currently only meaningful for agy-acp-map (conversationId semantics).
      if (agentId !== "antigravity-stdio") {
        return json({ ok: false, error: `Agent '${agentId}' 不支持空会话判定（仅 Antigravity 桥提供 conversationId 语义）。` }, 501);
      }
      try {
        const body = await readJson(req);
        const exceptIds = Array.isArray(body.exceptIds) ? body.exceptIds.map(String) : [];
        const { selectEmptySessions } = await import("./agent-installer");
        const conn = getConn();
        // One-click must work even when disconnected: connect on demand
        // (idempotent — returns the live connection when already connected).
        await conn.connect();
        // Walk every page: session/list is keyset-paginated (50/page), and
        // the oldest abandoned rows live on the last pages.
        const sessions: any[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 200; page++) {
          const listed: any = await conn.listSessions(cursor ? { cursor } : {});
          if (Array.isArray(listed?.sessions)) sessions.push(...listed.sessions);
          if (typeof listed?.nextCursor === "string" && listed.nextCursor) {
            cursor = listed.nextCursor;
          } else {
            break;
          }
        }
        const { deletable, kept } = selectEmptySessions(sessions, { exceptIds });
        const deleted: string[] = [];
        const errors: Array<{ sessionId: string; error: string }> = [];
        for (const d of deletable) {
          try {
            await conn.deleteSession({ sessionId: d.sessionId });
            deleted.push(d.sessionId);
          } catch (err) {
            errors.push({ sessionId: d.sessionId, error: (err as Error).message });
          }
        }
        return json({ ok: errors.length === 0, deleted, kept, errors });
      } catch (err) {
        return json({ ok: false, error: (err as Error).message }, 500);
      }
    }

    if (rest === "/status" && req.method === "GET") {
      try {
        const conn = getConn();
        return json({ ok: true, status: conn.status(), init: conn.getInitResult() });
      } catch (err) {
        return json({ ok: false, error: (err as Error).message }, 404);
      }
    }

    if (rest === "/authenticate" && req.method === "POST") {
      const body = await readJson(req);
      const methodId = String(body.methodId || body.method || "");
      if (!methodId) return json({ ok: false, error: "methodId is required" }, 400);
      try {
        const { methodId: _m, method: _mm, ...extra } = body as Record<string, unknown>;
        const res = await getConn().authenticate(methodId, extra as Record<string, unknown>);
        return json({ ok: true, result: res });
      } catch (err) {
        return gatewayError(err);
      }
    }

    if (rest === "/logout" && req.method === "POST") {
      try {
        const res = await getConn().logout();
        return json({ ok: true, result: res });
      } catch (err) {
        return gatewayError(err);
      }
    }

    const sessionAction = async (action: string): Promise<Response> => {
      const body = await readJson(req);
      try {
        const conn = getConn();
        await conn.connect().catch(() => undefined);
        let result: unknown;
        switch (action) {
          case "new":
            result = await conn.newSession({
              cwd: body.cwd as string | undefined,
              mcpServers: (body.mcpServers as unknown[]) || [],
              additionalDirectories: body.additionalDirectories as string[] | undefined,
            });
            break;
          case "load": {
            const loaded = await conn.loadSession(body);
            return json({ ok: true, result: loaded.result, replayed: loaded.replayed });
          }
          case "fork": {
            // UNSTABLE session/fork: {sessionId, cwd, additionalDirectories?, mcpServers?}
            const sid = String(body.sessionId || "");
            if (!sid) return json({ ok: false, error: "sessionId is required" }, 400);
            result = await conn.forkSession({
              sessionId: sid,
              cwd: (body.cwd as string) || process.cwd(),
              ...(body.additionalDirectories ? { additionalDirectories: body.additionalDirectories } : {}),
              ...(body.mcpServers ? { mcpServers: body.mcpServers } : {}),
            });
            break;
          }
          case "resume":
            result = await conn.resumeSession(body);
            break;
          case "list":
            result = await conn.listSessions(body);
            break;
          case "delete":
            result = await conn.deleteSession(body);
            break;
          case "close":
            result = await conn.closeSession(body);
            break;
          case "set_mode":
            result = await conn.setMode(body);
            break;
          case "set_config":
            result = await conn.setConfigOption(body);
            break;
          case "set_model": {
            // Legacy fallback (agy-style servers without config options).
            if (!body.sessionId || !body.modelId) {
              return json({ ok: false, error: "sessionId + modelId required" }, 400);
            }
            result = await conn.rawRequest("session/set_model", body);
            break;
          }
          case "cancel":
            await conn.cancel(String(body.sessionId || ""));
            result = { ok: true, cancelled: true };
            break;
          default:
            return json({ ok: false, error: `unknown session action ${action}` }, 404);
        }
        return json({ ok: true, result });
      } catch (err) {
        return gatewayError(err);
      }
    };

    if (rest.startsWith("/session/") && req.method === "POST") {
      const action = rest.slice("/session/".length);
      if (["new", "load", "resume", "list", "delete", "close", "cancel", "fork"].includes(action)) {
        return sessionAction(action);
      }
      if (action === "set_model" || action === "set-model") return sessionAction("set_model");
      if (action === "set_mode" || action === "set-mode") return sessionAction("set_mode");
      if (action === "set_config" || action === "set-config" || action === "set_config_option") {
        return sessionAction("set_config");
      }
    }

    // UNSTABLE providers/* (e.g. codex): list / set / disable
    const provMatch = rest.match(/^\/providers\/(list|set|disable)$/);
    if (provMatch && req.method === "POST") {
      const body = await readJson(req);
      try {
        const conn = getConn();
        await conn.connect().catch(() => undefined);
        const result = await conn.providersRpc(provMatch[1] as "list" | "set" | "disable", body);
        return json({ ok: true, result });
      } catch (err) {
        return gatewayError(err);
      }
    }

    if (rest === "" && req.method === "DELETE") {
      const ok = universalRegistry.removeProfile(agentId);
      if (!ok) return json({ ok: false, error: "cannot remove built-in agent or unknown id" }, 400);
      return json({ ok: true, removed: agentId });
    }
  }

  // ---- permission ----
  if (p === "/api/universal/permission/pending" && req.method === "GET") {
    const agentId = url.searchParams.get("agentId") || undefined;
    const sessionId = url.searchParams.get("sessionId") || undefined;
    const out: unknown[] = [];
    const ids = agentId ? [agentId] : universalRegistry.listProfiles().map((a) => a.id);
    for (const id of ids) {
      try {
        out.push(...universalRegistry.connFor(id).listPendingPermissions(sessionId));
      } catch {
        // ignore unknown
      }
    }
    return json({ ok: true, pending: out });
  }

  if (p === "/api/universal/permission/respond" && req.method === "POST") {
    const body = await readJson(req);
    const agentId = String(body.agentId || "");
    const permissionId = String(body.permissionId || "");
    if (!agentId || !permissionId) return json({ ok: false, error: "agentId + permissionId required" }, 400);
    try {
      const ok = universalRegistry.connFor(agentId).resolvePermission(permissionId, body.outcome ?? body);
      if (!ok) return json({ ok: false, error: "permission not found or expired" }, 404);
      return json({ ok: true });
    } catch (err) {
      return json({ ok: false, error: (err as Error).message }, 500);
    }
  }

  if (p === "/api/universal/elicitation/pending" && req.method === "GET") {
    const agentId = url.searchParams.get("agentId") || undefined;
    const sessionId = url.searchParams.get("sessionId") || undefined;
    const out: unknown[] = [];
    const ids = agentId ? [agentId] : universalRegistry.listProfiles().map((a) => a.id);
    for (const id of ids) {
      try {
        out.push(...universalRegistry.connFor(id).listPendingElicitations(sessionId));
      } catch {
        // ignore
      }
    }
    return json({ ok: true, pending: out });
  }

  if (p === "/api/universal/elicitation/respond" && req.method === "POST") {
    const body = await readJson(req);
    const agentId = String(body.agentId || "");
    const elicitationId = String(body.elicitationId || "");
    if (!agentId || !elicitationId) return json({ ok: false, error: "agentId + elicitationId required" }, 400);
    try {
      const ok = universalRegistry.connFor(agentId).resolveElicitation(elicitationId, body.result ?? body.response ?? body);
      if (!ok) return json({ ok: false, error: "elicitation not found or expired" }, 404);
      return json({ ok: true });
    } catch (err) {
      return json({ ok: false, error: (err as Error).message }, 500);
    }
  }

  // ---- chat SSE ----
  if (p === "/api/universal/chat" && req.method === "POST") {
    const body = await readJson(req);
    const agentId = String(body.agentId || "codex");
    let conn;
    try {
      conn = universalRegistry.connFor(agentId);
    } catch (err) {
      return json({ ok: false, error: (err as Error).message }, 404);
    }

    try {
      await conn.connect();
    } catch (err) {
      return gatewayError(err, `Agent '${agentId}' connect failed`);
    }

    let sessionId = (body.sessionId as string) || "";
    if (!sessionId) {
      try {
        const fresh = (await conn.newSession({
          cwd: body.cwd as string | undefined,
          mcpServers: (body.mcpServers as unknown[]) || [],
          additionalDirectories: body.additionalDirectories as string[] | undefined,
        })) as { sessionId?: string };
        sessionId = fresh.sessionId || "";
      } catch (err) {
        return gatewayError(err, "session/new failed");
      }
    }
    if (!sessionId) return json({ ok: false, error: "sessionId missing and session/new returned none" }, 500);

    const promptBlocks = normalizePrompt(body.prompt);

    // Client-disconnect propagation: forward req.signal into conn.prompt()
    // so a closed SSE stream cancels the in-flight turn server-side.
    const aborter = new AbortController();
    const reqSignal = (req as Request).signal as AbortSignal | undefined;
    let onReqAbort: (() => void) | undefined;
    try {
      if (reqSignal) {
        if (reqSignal.aborted) {
          aborter.abort();
        } else {
          onReqAbort = () => {
            try {
              aborter.abort();
            } catch (err) {
              console.error(`[Universal] chat abort forward failed: ${(err as Error).message}`);
            }
          };
          reqSignal.addEventListener("abort", onReqAbort, { once: true });
        }
      }
    } catch (err) {
      console.error(`[Universal] chat signal wiring failed: ${(err as Error).message}`);
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch (err) {
            console.error(`[Universal] SSE enqueue failed (closed?): ${(err as Error).message}`);
          }
        };
        const ping = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            // controller closed mid-keepalive: stop silently, close handled below
          }
        }, 2000);

        send({ type: "start", agentId, sessionId });
        try {
          const res = (await conn.prompt(
            sessionId,
            promptBlocks as unknown[],
            (evt) => {
              send({ ...evt, agentId, sessionId: (evt.sessionId as string) || sessionId });
            },
            { signal: aborter.signal }
          )) as { stopReason?: string } | undefined;
          send({ type: "done", agentId, sessionId, stopReason: res?.stopReason || "end_turn", response: res });
        } catch (err) {
          const msg = (err as Error).message || "prompt failed";
          // Mutex: same-session concurrent prompt() throws `... (409)` in
          // AgentConnection; surface as error event with code 409 so the
          // frontend can serialize (routes can't return HTTP 409 once SSE
          // headers are sent).
          const busy = /session busy.*\(409\)/i.test(msg);
          if (busy) {
            console.warn(`[Universal] chat rejected busy session=${sessionId}`);
          } else {
            console.error(`[Universal] chat prompt failed session=${sessionId}: ${msg}`);
          }
          send({ type: "error", agentId, sessionId, message: msg, ...(busy ? { code: 409 } : {}) });
        } finally {
          clearInterval(ping);
          try {
            if (onReqAbort && reqSignal) reqSignal.removeEventListener("abort", onReqAbort);
          } catch (err) {
            console.error(`[Universal] chat signal cleanup failed: ${(err as Error).message}`);
          }
          await new Promise((r) => setTimeout(r, 50));
          try {
            controller.close();
          } catch (err) {
            console.error(`[Universal] SSE close failed: ${(err as Error).message}`);
          }
        }
      },
      cancel() {
        try {
          aborter.abort();
        } catch (err) {
          console.error(`[Universal] SSE cancel abort failed: ${(err as Error).message}`);
        }
        try {
          conn.cancel(sessionId).catch((err: Error) => {
            console.error(`[Universal] SSE cancel session=${sessionId} failed: ${err.message}`);
          });
        } catch (err) {
          console.error(`[Universal] SSE cancel threw: ${(err as Error).message}`);
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ---- workspace ----
  if (p === "/api/universal/workspace/default" && req.method === "GET") {
    const cwd = process.cwd();
    return json({
      ok: true,
      path: cwd,
      name: path.basename(cwd),
    });
  }

  if (p === "/api/universal/workspace/validate" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const target = String(body.path || "").trim();
      if (!target) return json({ ok: false, error: "路径不能为空" }, 400);
      const resolved = path.resolve(target);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return json({ ok: false, error: "指定的路径不存在或不是有效目录" }, 400);
      }
      // Optional allowlist (security agent owned). Missing module => skip
      // (permissive) so existing flows keep working.
      // Even when present, currently advisory-only (warn, still allow) to avoid
      // breaking existing tmp-dir flows/tests (e.g. os.tmpdir() not under cwd).
      // TODO(security-agent): flip to default-deny (403) once ACP_WORKSPACE_ROOTS
      // covers test tmp dirs and UI flows are migrated.
      try {
        const allowed = await optionalIsPathAllowed(resolved);
        if (allowed === false) {
          console.warn(`[Universal] workspace outside allowlist (advisory, still allowing): ${resolved}`);
        }
      } catch (err) {
        console.error(`[Universal] workspace allowlist check failed: ${(err as Error).message}`);
      }
      const isGit = fs.existsSync(path.join(resolved, ".git"));
      return json({
        ok: true,
        path: resolved,
        name: path.basename(resolved),
        isGit,
      });
    } catch (err: any) {
      console.error(`[Universal] workspace validate failed: ${err.message || err}`);
      return json({ ok: false, error: err.message || "校验工作区失败" }, 400);
    }
  }

  // ---- terminal exec stream ----
  // Basic guards only (cwd exists+is-dir, non-empty, 8k length cap).
  // Full command allowlist is owned by the security agent
  // (server/universal/security.ts) — see TODO there.
  const EXEC_MAX_CHARS = 8000;
  if (p === "/api/universal/terminal/exec" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const cwd = String(body.cwd || process.cwd());
      const cmd = String(body.command || "").trim();
      if (!cmd) return json({ ok: false, error: "command is required" }, 400);
      if (cmd.length > EXEC_MAX_CHARS) {
        return json({ ok: false, error: `command too long (max ${EXEC_MAX_CHARS} chars)` }, 400);
      }

      const shellBin = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
      const shellArgs = process.platform === "win32" ? ["-NoProfile", "-Command", cmd] : ["-c", cmd];

      const { spawn } = await import("node:child_process");
      let targetCwd: string;
      try {
        targetCwd = fs.existsSync(cwd) && fs.statSync(cwd).isDirectory() ? cwd : process.cwd();
        if (targetCwd !== cwd) {
          console.warn(`[Universal] terminal cwd ${cwd} missing/not-a-dir, using ${targetCwd}`);
        }
      } catch (err) {
        console.error(`[Universal] terminal cwd check failed: ${(err as Error).message}`);
        targetCwd = process.cwd();
      }
      const proc = spawn(shellBin, shellArgs, {
        cwd: targetCwd,
        env: { ...process.env, TERM: "xterm-256color" },
        windowsHide: true,
      });

      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          proc.stdout.on("data", (chunk: Buffer) => controller.enqueue(chunk));
          proc.stderr.on("data", (chunk: Buffer) => controller.enqueue(chunk));
          proc.on("close", (code) => {
            controller.enqueue(enc.encode(`\r\n\x1b[90m[Process finished with exit code ${code ?? 0}]\x1b[0m\r\n`));
            controller.close();
          });
          proc.on("error", (err) => {
            controller.enqueue(enc.encode(`\r\n\x1b[31m[Process error: ${err.message}]\x1b[0m\r\n`));
            controller.close();
          });
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-cache",
        },
      });
    } catch (err: any) {
      console.error(`[Universal] terminal exec failed: ${err.message || err}`);
      return json({ ok: false, error: err.message }, 500);
    }
  }

  const gitRes = await handleGit(req, url);
  if (gitRes) return gitRes;

  return json({ ok: false, error: `Unknown universal route ${req.method} ${p}` }, 404);
}
