/**
 * Runtime-agnostic HTTP gateway (Bun.serve AND Node/Hono compatible).
 * All routes speak WinterCG Request/Response only — no Bun.* / node:http APIs.
 * Entries: server/index.ts (Bun) and server/node.ts (Node, for Electron).
 */
import { Hono } from "hono";
import { AgyAcpBridge } from "./bridge/agyBridge";
import { handleUniversal } from "./universal/routes";
import { universalRegistry } from "./universal/registry";
import { execSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

export function setupEnv() {
  // Auto-detect Google Antigravity CLI binary location
  if (!process.env.AGY_BIN) {
    const candidate = path.join(os.homedir(), ".gemini", "bin", process.platform === "win32" ? "agy.exe" : "agy");
    if (fs.existsSync(candidate)) {
      process.env.AGY_BIN = candidate;
    }
  }
  const geminiBinDir = path.join(os.homedir(), ".gemini", "bin");
  if (fs.existsSync(geminiBinDir) && !process.env.PATH?.includes(geminiBinDir)) {
    process.env.PATH = `${geminiBinDir}${path.delimiter}${process.env.PATH || ""}`;
  }
}

export const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3004;

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err);
});

console.log("[Server] Initializing Google Antigravity ACP Studio Server (powered by agy-acp-map)...");
export const agyBridge = new AgyAcpBridge(process.cwd());

// Eagerly initialize bridge and prefetch models
agyBridge
  .init()
  .then(() => {
    const status = agyBridge.getStatus();
    console.log(
      `[Server] Antigravity ACP Bridge ready (${status.mode} mode, v${status.packageVersion}). Models: ${status.models.length}. Default: ${status.currentModelId}`
    );
  })
  .catch((err) => {
    console.warn("[Server] Warning: Bridge initialization note:", err.message);
  });

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function freePortIfOccupied(port: number) {
  if (process.platform !== "win32") return;
  try {
    const stdout = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      encoding: "utf8",
      windowsHide: true,
    });
    const lines = stdout.trim().split("\n");
    const seenPids = new Set<string>();
    let killedAny = false;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (!pid || pid === String(process.pid) || pid === "0" || seenPids.has(pid)) continue;
      seenPids.add(pid);
      console.log(`[Server] Freeing lingering process PID ${pid} on port ${port}...`);
      try {
        execSync(`taskkill /F /PID ${pid} 2>nul`, { windowsHide: true });
        killedAny = true;
      } catch {
        // ignore
      }
    }
    if (killedAny) {
      // Allow Windows socket table up to 1 second to release the port
      for (let i = 0; i < 10; i++) {
        try {
          const check = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
            encoding: "utf8",
            windowsHide: true,
          });
          if (!check.trim()) break;
        } catch {
          break;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
  } catch {
    // Port is not occupied
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function sseHeaders(): Record<string, string> {
  return {
    ...corsHeaders(),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

export function buildApp() {
  const app = new Hono();

  // Universal ACP gateway (generic stdio agents: codex, gemini, claude, ...)
  // Mounted first so /api/universal/* never falls through to legacy routes.
  app.all("/api/universal/*", async (c) => {
    try {
      const universal = await handleUniversal(c.req.raw);
      if (universal) return universal;
    } catch (err: any) {
      return Response.json({ ok: false, error: err?.message || "universal gateway error" }, { status: 500, headers: corsHeaders() });
    }
    return c.text("Not Found", 404);
  });

  app.options("*", (c) => new Response(null, { headers: corsHeaders() }));

  // 1. Health & Status
  app.get("/api/status", async (c) => {
    try {
      await agyBridge.ensureReady();
      const status = agyBridge.getStatus();
      return Response.json(status, { headers: corsHeaders() });
    } catch (err: any) {
      return Response.json(
        { ok: false, error: err.message, status: agyBridge.getStatus() },
        { status: 500, headers: corsHeaders() }
      );
    }
  });

  // 2. Auth Endpoint
  app.post("/api/auth/login", (c) =>
    Response.json(
      {
        ok: true,
        message: "已自动连接 Google Antigravity CLI 本地认证环境，无需额外配置。",
      },
      { headers: corsHeaders() }
    )
  );

  // 3. Fetch models
  app.get("/api/models", async (c) => {
    try {
      const models = await agyBridge.getModels();
      return Response.json(
        { ok: true, models: models.availableModels, currentModelId: models.currentModelId },
        { headers: corsHeaders() }
      );
    } catch (err: any) {
      return Response.json({ ok: false, error: err.message }, { status: 500, headers: corsHeaders() });
    }
  });

  // 4. Set model
  app.post("/api/model/set", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string; modelId?: string };
      if (!body.modelId) {
        return Response.json({ ok: false, error: "modelId is required" }, { status: 400, headers: corsHeaders() });
      }
      await agyBridge.setSessionModel(body.sessionId || "default", body.modelId);
      return Response.json({ ok: true, sessionId: body.sessionId, modelId: body.modelId }, { headers: corsHeaders() });
    } catch (err: any) {
      return Response.json({ ok: false, error: err.message }, { status: 500, headers: corsHeaders() });
    }
  });

  // 5. Create new Session
  app.post("/api/session/new", async (c) => {
    try {
      const res = await agyBridge.createSession();
      return Response.json(res, { headers: corsHeaders() });
    } catch (err: any) {
      return Response.json({ ok: false, error: err.message }, { status: 500, headers: corsHeaders() });
    }
  });

  // 6. Cancel active prompt on session
  app.post("/api/chat/stop", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string };
      if (body.sessionId) {
        await agyBridge.cancel(body.sessionId);
      }
      return Response.json({ ok: true, cancelled: true }, { headers: corsHeaders() });
    } catch (err: any) {
      return Response.json({ ok: false, error: err.message }, { status: 500, headers: corsHeaders() });
    }
  });

  // 7. Bridge Mode (library-only; generic stdio agents live under /api/universal)
  app.post("/api/bridge/mode", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { mode?: string };
    if (body.mode === "library" || body.mode === "process") {
      agyBridge.setMode(body.mode as "library");
      return Response.json({ ok: true, mode: agyBridge.currentMode }, { headers: corsHeaders() });
    }
    return Response.json({ ok: false, error: "Invalid mode. Only 'library' is supported" }, { status: 400, headers: corsHeaders() });
  });

  // 8. Chat Streaming via SSE (Transport: Web SSE ↔ ACP session/prompt)
  app.post("/api/chat", async (c) => {
    let body: { prompt?: string | any[]; model?: string; mode?: string; sessionId?: string };
    try {
      body = await c.req.json();
    } catch {
      console.error("[Server] Invalid JSON body in /api/chat");
      return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers: corsHeaders() });
    }

    console.log(`[Server] POST /api/chat received: sid: ${body.sessionId || '(none)'}, model: ${body.model || 'default'}, prompt: "${typeof body.prompt === 'string' ? body.prompt.slice(0, 60) : JSON.stringify(body.prompt).slice(0, 60)}"`);

    let sessionId = body.sessionId;
    if (!sessionId) {
      try {
        const fresh = await agyBridge.createSession();
        sessionId = fresh.sessionId;
        console.log(`[Server] Created fresh session for chat: ${sessionId}`);
      } catch (err: any) {
        console.error(`[Server] Failed to create session:`, err.message);
        return Response.json(
          { ok: false, error: `Failed to create session: ${err.message}` },
          { status: 500, headers: corsHeaders() }
        );
      }
    }

    if (body.model) {
      try {
        await agyBridge.setSessionModel(sessionId, body.model);
      } catch (err: any) {
        console.warn(`[Server] Failed to switch model to ${body.model}:`, err.message);
      }
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: any) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // controller closed
          }
        };

        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            // ignore
          }
        }, 2000);

        console.log(`[Server][SSE] Dispatching "start" event for sid: ${sessionId}`);
        send({ type: "start", sessionId });

        try {
          const promptBlocks = Array.isArray(body.prompt)
            ? body.prompt
            : [{ type: "text", text: String(body.prompt || "") }];

          const activeSessionId = sessionId!;
          console.log(`[Server][SSE] Initiating bridge.prompt for sid: ${activeSessionId}`);
          const outcome = await agyBridge.prompt(
            activeSessionId,
            promptBlocks,
            (update: any) => {
              console.log(`[Server][SSE] Pushing update to client (sid: ${activeSessionId}): ${update?.sessionUpdate || 'unknown'}`);
              send({
                type: "update",
                sessionId: activeSessionId,
                update,
              });
            },
            { model: body.model, mode: body.mode }
          );

          console.log(`[Server][SSE] Dispatching "done" event (sid: ${activeSessionId}) stopReason: ${outcome.stopReason}`);
          send({
            type: "done",
            sessionId: activeSessionId,
            stopReason: outcome.stopReason,
          });
        } catch (err: any) {
          console.error(`[Server][SSE] Prompt execution error (sid: ${sessionId}):`, err);
          send({
            type: "error",
            sessionId,
            message: err.message || "Antigravity ACP execution error",
          });
        } finally {
          clearInterval(pingInterval);
          // Allow event loop to dispatch final SSE chunk into TCP buffer
          await new Promise((r) => setTimeout(r, 50));
          try {
            controller.close();
            console.log(`[Server][SSE] Stream controller closed cleanly (sid: ${sessionId})`);
          } catch {
            // ignore
          }
        }
      },
    });

    return new Response(stream, { headers: sseHeaders() });
  });

  // Static frontend (production/Electron): serve the public dir, SPA fallback.
  // Runtime-agnostic fs read so Bun and Node share this path.
  // ACP_PUBLIC_DIR overrides the default ./dist (Electron sets it to the
  // packaged app dir since cwd is not reliable there).
  const publicDir = () =>
    process.env.ACP_PUBLIC_DIR || path.join(process.cwd(), "dist");
  app.get("*", (c) => {
    const DIST = publicDir();
    const reqPath = new URL(c.req.url).pathname;
    if (reqPath.startsWith("/api/")) {
      return new Response("Not Found", { status: 404, headers: corsHeaders() });
    }
    const rel = path.normalize(reqPath === "/" ? "/index.html" : reqPath).replace(/^([/\\])+/, "");
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file).toLowerCase();
        return new Response(fs.readFileSync(file), {
          headers: { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" },
        });
      }
    } catch {
      // fall through to SPA fallback
    }
    const index = path.join(DIST, "index.html");
    if (fs.existsSync(index)) {
      return new Response(fs.readFileSync(index), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  });

  return app;
}

export async function shutdownBridges() {
  await agyBridge.shutdown();
  await universalRegistry.shutdown().catch(() => undefined);
}
