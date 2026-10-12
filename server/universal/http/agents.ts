/**
 * /api/universal/agents/* — agent profiles and per-agent connection lifecycle
 * (connect / disconnect / status / authenticate / logout / providers /
 * empty-session cleanup). Session RPCs live in ./sessions.ts.
 */
import { Hono } from "hono";
import { z } from "zod";
import { universalRegistry } from "../registry";
import { anyBody, gatewayError, json, jsonBody, optStr } from "./shared";

export const agentsRouter = new Hono();

agentsRouter.get("/", () => {
  const profiles = universalRegistry.listProfiles();
  const statuses = universalRegistry.statuses();
  const byId = new Map(statuses.map((s) => [s.id, s]));
  return json({
    ok: true,
    agents: profiles.map((pr) => ({ ...pr, status: byId.get(pr.id) || { connected: false } })),
  });
});

const profileBody = z.looseObject({
  id: optStr,
  name: optStr,
  title: optStr,
  description: optStr,
  homepage: optStr,
  command: optStr,
  args: z.array(z.unknown()).nullish(),
  env: z.record(z.string(), z.string()).nullish(),
  defaultCwd: optStr,
  authHint: optStr,
  installHint: optStr,
});

agentsRouter.post("/", jsonBody(profileBody), (c) => {
  const body = c.get("body");
  try {
    const saved = universalRegistry.upsertProfile({
      id: String(body.id || ""),
      name: String(body.name || body.id || ""),
      title: String(body.title || body.id || ""),
      description: body.description ?? undefined,
      homepage: body.homepage ?? undefined,
      command: String(body.command || ""),
      args: Array.isArray(body.args) ? body.args.map(String) : [],
      env: body.env || {},
      defaultCwd: body.defaultCwd ?? undefined,
      authHint: body.authHint ?? undefined,
      installHint: body.installHint ?? undefined,
    });
    return json({ ok: true, agent: saved });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 400);
  }
});

agentsRouter.delete("/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const ok = universalRegistry.removeProfile(agentId);
  if (!ok) return json({ ok: false, error: "cannot remove built-in agent or unknown id" }, 400);
  return json({ ok: true, removed: agentId });
});

agentsRouter.post("/:agentId/connect", async (c) => {
  const agentId = c.req.param("agentId");
  try {
    const conn = universalRegistry.connFor(agentId);
    const init = await conn.connect();
    return json({ ok: true, status: conn.status(), init });
  } catch (err) {
    const st = universalRegistry.connFor(agentId).status();
    const rawMsg = err instanceof Error ? err.message : String(err ?? "");
    const error = (rawMsg && rawMsg !== "null" && rawMsg !== "undefined") ? rawMsg : (st.lastError || "Agent connection failed");
    return json({ ok: false, error, status: st }, 500);
  }
});

agentsRouter.post("/:agentId/disconnect", async (c) => {
  const agentId = c.req.param("agentId");
  try {
    await universalRegistry.connFor(agentId).disconnect();
  } catch (err) {
    console.error(`[Universal] disconnect failed ${agentId}: ${(err as Error).message}`);
  }
  return json({ ok: true, status: universalRegistry.connFor(agentId).status() });
});

agentsRouter.get("/:agentId/status", (c) => {
  try {
    const conn = universalRegistry.connFor(c.req.param("agentId"));
    return json({ ok: true, status: conn.status(), init: conn.getInitResult() });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 404);
  }
});

const authenticateBody = z.looseObject({ methodId: optStr, method: optStr });

agentsRouter.post("/:agentId/authenticate", jsonBody(authenticateBody), async (c) => {
  const body = c.get("body");
  const methodId = String(body.methodId || body.method || "");
  if (!methodId) return json({ ok: false, error: "methodId is required" }, 400);
  try {
    const { methodId: _m, method: _mm, ...extra } = body as Record<string, unknown>;
    const res = await universalRegistry.connFor(c.req.param("agentId")).authenticate(methodId, extra);
    return json({ ok: true, result: res });
  } catch (err) {
    return gatewayError(err);
  }
});

agentsRouter.post("/:agentId/logout", async (c) => {
  try {
    const res = await universalRegistry.connFor(c.req.param("agentId")).logout();
    return json({ ok: true, result: res });
  } catch (err) {
    return gatewayError(err);
  }
});

// UNSTABLE providers/* (e.g. codex): list / set / disable
agentsRouter.post("/:agentId/providers/:action{list|set|disable}", jsonBody(anyBody), async (c) => {
  const body = c.get("body");
  try {
    const conn = universalRegistry.connFor(c.req.param("agentId"));
    // Connect on demand; a real connect failure resurfaces from providersRpc below.
    await conn.connect().catch((err: Error) => {
      console.warn(`[Universal] providers connect failed (request will report it): ${err?.message || err}`);
    });
    const result = await conn.providersRpc(c.req.param("action") as "list" | "set" | "disable", body);
    return json({ ok: true, result });
  } catch (err) {
    return gatewayError(err);
  }
});

const emptySessionsBody = z.looseObject({ exceptIds: z.array(z.unknown()).nullish() });

agentsRouter.delete("/:agentId/sessions/empty", jsonBody(emptySessionsBody), async (c) => {
  // One-click cleanup of abandoned empty sessions. Strict and loud:
  // only rows the agent marks as turn-less AND old AND unbound are
  // deleted; every skip/failure is reported, never silently swallowed.
  // Currently only meaningful for agy-acp-map (conversationId semantics).
  const agentId = c.req.param("agentId");
  if (agentId !== "antigravity-stdio") {
    return json({ ok: false, error: `Agent '${agentId}' 不支持空会话判定（仅 Antigravity 桥提供 conversationId 语义）。` }, 501);
  }
  try {
    const body = c.get("body");
    const exceptIds = Array.isArray(body.exceptIds) ? body.exceptIds.map(String) : [];
    const { selectEmptySessions } = await import("../agent-installer");
    const conn = universalRegistry.connFor(agentId);
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
});
