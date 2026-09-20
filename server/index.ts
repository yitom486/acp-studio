import { AgyAcpBridge } from "./bridge/agyBridge";
import { execSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

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

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3004;

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err);
});

console.log("[Server] Initializing Google Antigravity ACP Studio Server (powered by agy-acp-map)...");
const agyBridge = new AgyAcpBridge(process.cwd());

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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled Rejection:", reason);
});

function freePortIfOccupied(port: number) {
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

freePortIfOccupied(PORT);

const server = Bun.serve({
  port: PORT,
  idleTimeout: 0, // Disable idle timeout so server never exits
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // 1. Health & Status
    if (url.pathname === "/api/status" && req.method === "GET") {
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
    }

    // 2. Auth Endpoint
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      return Response.json(
        {
          ok: true,
          message: "已自动连接 Google Antigravity CLI 本地认证环境，无需额外配置。",
        },
        { headers: corsHeaders() }
      );
    }

    // 3. Fetch models
    if (url.pathname === "/api/models" && req.method === "GET") {
      try {
        const models = await agyBridge.getModels();
        return Response.json(
          { ok: true, models: models.availableModels, currentModelId: models.currentModelId },
          { headers: corsHeaders() }
        );
      } catch (err: any) {
        return Response.json({ ok: false, error: err.message }, { status: 500, headers: corsHeaders() });
      }
    }

    // 4. Set model
    if (url.pathname === "/api/model/set" && req.method === "POST") {
      try {
        const body = (await req.json().catch(() => ({}))) as { sessionId?: string; modelId?: string };
        if (!body.modelId) {
          return Response.json({ ok: false, error: "modelId is required" }, { status: 400, headers: corsHeaders() });
        }
        await agyBridge.setSessionModel(body.sessionId || "default", body.modelId);
        return Response.json({ ok: true, sessionId: body.sessionId, modelId: body.modelId }, { headers: corsHeaders() });
      } catch (err: any) {
        return Response.json({ ok: false, error: err.message }, { status: 500, headers: corsHeaders() });
      }
    }

    // 5. Create new Session
    if (url.pathname === "/api/session/new" && req.method === "POST") {
      try {
        const res = await agyBridge.createSession();
        return Response.json(res, { headers: corsHeaders() });
      } catch (err: any) {
        return Response.json({ ok: false, error: err.message }, { status: 500, headers: corsHeaders() });
      }
    }

    // 6. Cancel active prompt on session
    if (url.pathname === "/api/chat/stop" && req.method === "POST") {
      try {
        const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
        if (body.sessionId) {
          await agyBridge.cancel(body.sessionId);
        }
        return Response.json({ ok: true, cancelled: true }, { headers: corsHeaders() });
      } catch (err: any) {
        return Response.json({ ok: false, error: err.message }, { status: 500, headers: corsHeaders() });
      }
    }

    // 7. Toggle Bridge Mode (Library vs Process)
    if (url.pathname === "/api/bridge/mode" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { mode?: "library" | "process" };
      if (body.mode === "library" || body.mode === "process") {
        agyBridge.setMode(body.mode);
        return Response.json({ ok: true, mode: agyBridge.currentMode }, { headers: corsHeaders() });
      }
      return Response.json({ ok: false, error: "Invalid mode. Use 'library' or 'process'" }, { status: 400, headers: corsHeaders() });
    }

    // 8. Chat Streaming via SSE (Transport: Web SSE ↔ ACP session/prompt)
    if (url.pathname === "/api/chat" && req.method === "POST") {
      let body: { prompt?: string | any[]; model?: string; mode?: string; sessionId?: string };
      try {
        body = await req.json();
      } catch {
        return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers: corsHeaders() });
      }

      let sessionId = body.sessionId;
      if (!sessionId) {
        try {
          const fresh = await agyBridge.createSession();
          sessionId = fresh.sessionId;
        } catch (err: any) {
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

      try {
        server.timeout(req, 0);
      } catch {
        // ignore
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

          send({ type: "start", sessionId });

          try {
            const promptBlocks = Array.isArray(body.prompt)
              ? body.prompt
              : [{ type: "text", text: String(body.prompt || "") }];

            let activeSessionId = sessionId!;
            const outcome = await agyBridge.prompt(
              activeSessionId,
              promptBlocks,
              (update: any) => {
                send({
                  type: "update",
                  sessionId: activeSessionId,
                  update,
                });
              },
              { model: body.model, mode: body.mode }
            );

            send({
              type: "done",
              sessionId: activeSessionId,
              stopReason: outcome.stopReason,
            });
          } catch (err: any) {
            console.error("[Server] Prompt error:", err);
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

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  },
});

// Explicit keepalive timer to ensure Bun process never drains event loop when idle on Windows
const keepAliveTimer = setInterval(() => {}, 60_000);

const gracefulShutdown = async () => {
  console.log("\n[Server] Shutting down cleanly...");
  clearInterval(keepAliveTimer);
  server.stop(true);
  await agyBridge.shutdown();
  process.exit(0);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

console.log(`[Server] Google Antigravity ACP Studio server running at http://localhost:${PORT}`);
