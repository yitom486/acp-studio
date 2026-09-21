import { universalRegistry } from "./registry";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
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
        command: String(body.command || ""),
        args: Array.isArray(body.args) ? (body.args as unknown[]).map(String) : [],
        env: (body.env as Record<string, string>) || {},
        defaultCwd: body.defaultCwd as string | undefined,
      });
      return json({ ok: true, agent: saved });
    } catch (err) {
      return json({ ok: false, error: (err as Error).message }, 400);
    }
  }

  const agentMatch = p.match(/^\/api\/universal\/agents\/([^/]+)(\/.*)?$/);
  if (agentMatch) {
    const agentId = decodeURIComponent(agentMatch[1]);
    const rest = agentMatch[2] || "";

    const getConn = () => universalRegistry.connFor(agentId);

    if (rest === "/connect" && req.method === "POST") {
      try {
        const conn = getConn();
        const init = await conn.connect();
        return json({ ok: true, status: conn.status(), init });
      } catch (err) {
        return json({ ok: false, error: (err as Error).message, status: getConn().status() }, 500);
      }
    }

    if (rest === "/disconnect" && req.method === "POST") {
      await getConn().disconnect().catch(() => undefined);
      return json({ ok: true, status: getConn().status() });
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
        return json({ ok: false, error: (err as Error).message }, 500);
      }
    }

    if (rest === "/logout" && req.method === "POST") {
      try {
        const res = await getConn().logout();
        return json({ ok: true, result: res });
      } catch (err) {
        return json({ ok: false, error: (err as Error).message }, 500);
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
        return json({ ok: false, error: (err as Error).message }, 500);
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
        return json({ ok: false, error: (err as Error).message }, 500);
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
      return json({ ok: false, error: `Agent '${agentId}' connect failed: ${(err as Error).message}` }, 500);
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
        return json({ ok: false, error: `session/new failed: ${(err as Error).message}` }, 500);
      }
    }
    if (!sessionId) return json({ ok: false, error: "sessionId missing and session/new returned none" }, 500);

    const promptBlocks = normalizePrompt(body.prompt);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // closed
          }
        };
        const ping = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            // ignore
          }
        }, 2000);

        send({ type: "start", agentId, sessionId });
        try {
          const res = (await conn.prompt(sessionId, promptBlocks as unknown[], (evt) => {
            send({ ...evt, agentId, sessionId: (evt.sessionId as string) || sessionId });
          })) as { stopReason?: string } | undefined;
          send({ type: "done", agentId, sessionId, stopReason: res?.stopReason || "end_turn", response: res });
        } catch (err) {
          send({ type: "error", agentId, sessionId, message: (err as Error).message || "prompt failed" });
        } finally {
          clearInterval(ping);
          await new Promise((r) => setTimeout(r, 50));
          try {
            controller.close();
          } catch {
            // ignore
          }
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

  return json({ ok: false, error: `Unknown universal route ${req.method} ${p}` }, 404);
}
