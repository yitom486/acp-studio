/**
 * /api/universal/agents/:agentId/session/:action — ACP session RPCs
 * (new / load / resume / fork / list / delete / close / cancel /
 * set_mode / set_config / set_model, with the legacy dash aliases).
 */
import { Hono } from "hono";
import { z } from "zod";
import { universalRegistry } from "../registry";
import { gatewayError, json, jsonBody, optStr } from "./shared";

/** URL action → canonical action (legacy aliases kept for older clients). */
const ACTIONS: Record<string, string> = {
  new: "new",
  load: "load",
  resume: "resume",
  list: "list",
  delete: "delete",
  close: "close",
  cancel: "cancel",
  fork: "fork",
  set_model: "set_model",
  "set-model": "set_model",
  set_mode: "set_mode",
  "set-mode": "set_mode",
  set_config: "set_config",
  "set-config": "set_config",
  set_config_option: "set_config",
  commands: "commands",
};

/** Known fields are type-checked; everything else is forwarded to the agent untouched. */
const sessionBody = z.looseObject({
  sessionId: optStr,
  cwd: optStr,
  mcpServers: z.array(z.unknown()).nullish(),
  additionalDirectories: z.array(z.string()).nullish(),
  modelId: optStr,
});

export const sessionsRouter = new Hono();

sessionsRouter.post("/:agentId/session/:action", jsonBody(sessionBody), async (c) => {
  const raw = c.req.param("action");
  const action = Object.hasOwn(ACTIONS, raw) ? ACTIONS[raw] : undefined;
  if (!action) return json({ ok: false, error: `Unknown universal route POST ${new URL(c.req.url).pathname}` }, 404);
  const body = c.get("body") as Record<string, unknown> & z.infer<typeof sessionBody>;
  try {
    const conn = universalRegistry.connFor(c.req.param("agentId"));
    // Connect on demand; a real connect failure resurfaces from the RPC below.
    await conn.connect().catch((err: Error) => {
      console.warn(`[Universal] session/${action} connect failed (request will report it): ${err?.message || err}`);
    });
    let result: unknown;
    switch (action) {
      case "new":
        result = await conn.newSession({
          cwd: body.cwd ?? undefined,
          mcpServers: body.mcpServers || [],
          additionalDirectories: body.additionalDirectories ?? undefined,
        });
        result = await withCommands(conn, result);
        break;
      case "load": {
        const loaded = await conn.loadSession(body);
        return json({ ok: true, result: await withCommands(conn, loaded.result, String(body.sessionId || "")), replayed: loaded.replayed });
      }
      case "commands": {
        const sid = String(body.sessionId || "");
        if (!sid) return json({ ok: false, error: "sessionId is required" }, 400);
        const cached = conn.getAvailableCommands(sid);
        result = { sessionId: sid, availableCommands: cached ?? null };
        break;
      }
      case "fork": {
        // UNSTABLE session/fork: {sessionId, cwd, additionalDirectories?, mcpServers?}
        const sid = String(body.sessionId || "");
        if (!sid) return json({ ok: false, error: "sessionId is required" }, 400);
        result = await conn.forkSession({
          sessionId: sid,
          cwd: body.cwd || process.cwd(),
          ...(body.additionalDirectories ? { additionalDirectories: body.additionalDirectories } : {}),
          ...(body.mcpServers ? { mcpServers: body.mcpServers } : {}),
        });
        break;
      }
      case "resume":
        result = await withCommands(conn, await conn.resumeSession(body), String(body.sessionId || ""));
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
      case "set_model":
        // Legacy fallback (agy-style servers without config options).
        if (!body.sessionId || !body.modelId) {
          return json({ ok: false, error: "sessionId + modelId required" }, 400);
        }
        result = await conn.rawRequest("session/set_model", body);
        break;
      case "cancel":
        await conn.cancel(String(body.sessionId || ""));
        result = { ok: true, cancelled: true };
        break;
    }
    return json({ ok: true, result });
  } catch (err) {
    return gatewayError(err);
  }
});

/** Attach cached availableCommands (if the agent sent any) to a session result. */
async function withCommands(
  conn: { awaitAvailableCommands(sid: string, maxMs?: number): Promise<unknown[] | undefined> },
  result: unknown,
  sid?: string,
): Promise<unknown> {
  const id = sid || String((result as { sessionId?: unknown } | null)?.sessionId || "");
  if (!id) return result;
  const cmds = await conn.awaitAvailableCommands(id);
  if (!cmds) return result;
  return { ...((result as Record<string, unknown>) || {}), availableCommands: cmds };
}
