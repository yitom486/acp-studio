import { AntigravityAcpProcessManager } from "./acp/processManager";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3004;

console.log("[Server] Initializing Antigravity Official ACP Studio Server...");
const processManager = new AntigravityAcpProcessManager(process.cwd());

// Eagerly initiate connection to official agy_acp_server
processManager.ensureRunning().catch((err) => {
  console.error("[Server] Warning: Failed to eagerly start official ACP server:", err.message);
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
import { execSync } from "child_process";

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255, // Prevent premature socket termination
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // 1. Health & Official Status
    if (url.pathname === "/api/status" && req.method === "GET") {
      try {
        await processManager.ensureRunning();
        const status = processManager.getStatus();
        return Response.json(
          {
            ok: true,
            isOfficial: true,
            service: "Google Antigravity Official ACP Studio",
            protocol: "Agent Client Protocol (ACP) v1",
            agentInfo: status.agentInfo,
            agentCapabilities: status.agentCapabilities,
            auth: {
              authenticated: status.hasCredentials,
              method: status.authMethod || "oauth-personal",
              authMethods: status.authMethods || [],
              latestOAuthUrl: status.latestOAuthUrl,
            },
            binary: status.serverInfo,
            // Real model list advertised by the official ACP server (from session/new).
            models: status.models?.availableModels ?? [],
            currentModelId: status.models?.currentModelId ?? null,
          },
          { headers: corsHeaders() }
        );
      } catch (err: any) {
        return Response.json(
          { ok: false, error: err.message, status: processManager.getStatus() },
          { status: 500, headers: corsHeaders() }
        );
      }
    }

    // 2. Google OAuth Authentication (Official ACP authenticate method)
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      try {
        const body = (await req.json().catch(() => ({}))) as {
          methodId?: string;
          apiKey?: string;
          [key: string]: any;
        };
        const methodId = body.methodId || "oauth-personal";
        const res = await processManager.authenticate(methodId, body);
        return Response.json(res, { headers: corsHeaders() });
      } catch (err: any) {
        return Response.json(
          { ok: false, error: err.message },
          { status: 500, headers: corsHeaders() }
        );
      }
    }

    // 2b. Fetch the real model list from the official ACP server (may create a temp session)
    if (url.pathname === "/api/models" && req.method === "GET") {
      try {
        const models = await processManager.getModels();
        return Response.json(
          { ok: true, models: models?.availableModels ?? [], currentModelId: models?.currentModelId ?? null },
          { headers: corsHeaders() }
        );
      } catch (err: any) {
        return Response.json(
          { ok: false, error: err.message },
          { status: 500, headers: corsHeaders() }
        );
      }
    }

    // 2c. Switch an active session's model via session/set_model
    if (url.pathname === "/api/model/set" && req.method === "POST") {
      try {
        const body = (await req.json().catch(() => ({}))) as { sessionId?: string; modelId?: string };
        if (!body.sessionId || !body.modelId) {
          return Response.json({ ok: false, error: "sessionId and modelId are required" }, { status: 400, headers: corsHeaders() });
        }
        await processManager.setSessionModel(body.sessionId, body.modelId);
        return Response.json({ ok: true, sessionId: body.sessionId, modelId: body.modelId }, { headers: corsHeaders() });
      } catch (err: any) {
        return Response.json({ ok: false, error: err.message }, { status: 500, headers: corsHeaders() });
      }
    }

    // 3. Create new ACP Session
    if (url.pathname === "/api/session/new" && req.method === "POST") {
      try {
        const res = await processManager.createSession();
        return Response.json(res, { headers: corsHeaders() });
      } catch (err: any) {
        return Response.json(
          { ok: false, error: err.message },
          { status: 500, headers: corsHeaders() }
        );
      }
    }

    // 4. Cancel active prompt on session
    if (url.pathname === "/api/chat/stop" && req.method === "POST") {
      try {
        const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
        if (body.sessionId) {
          await processManager.cancel(body.sessionId);
        }
        return Response.json({ ok: true, cancelled: true }, { headers: corsHeaders() });
      } catch (err: any) {
        return Response.json(
          { ok: false, error: err.message },
          { status: 500, headers: corsHeaders() }
        );
      }
    }

    // 5. Chat Streaming via SSE (Transport A: Web SSE �?Transport B: Official ACP stdio)
    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = (await req.json()) as {
        prompt: string;
        model?: string;
        mode?: string;
        sessionId?: string;
      };

      // Ensure active session exists on official server
      let sessionId = body.sessionId;
      if (!sessionId) {
        try {
          const fresh = await processManager.createSession();
          sessionId = fresh.sessionId;
        } catch (err: any) {
          return Response.json(
            { ok: false, error: `Failed to create session on official ACP server: ${err.message}` },
            { status: 500, headers: corsHeaders() }
          );
        }
      }

      // Apply requested model if provided (session-scoped, superseded RPC still handled)
      if (body.model) {
        try {
          await processManager.setSessionModel(sessionId, body.model);
        } catch (err: any) {
          console.warn(`[Server] Failed to switch model to ${body.model}:`, err.message);
        }
      }

      // Configure request timeout = 0 for streaming
      try {
        server.timeout(req, 0);
      } catch {
        // ignore if not supported in this runtime version
      }

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (data: any) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            } catch {
              // controller may be closed
            }
          };

          // Web Transport Keep-Alive comment: SSE heartbeat ONLY for proxy/browser timeout prevention
          // This is purely Transport A and is NEVER forwarded to ACP stdio!
          const pingInterval = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`: keepalive\n\n`));
            } catch {
              // ignore
            }
          }, 2000);

          // Notify start
          send({ type: "start", sessionId });

          try {
            // Build standardized ACP prompt blocks
            const promptBlocks = Array.isArray(body.prompt)
              ? body.prompt
              : [{ type: "text", text: body.prompt }];

            // Stream real ACP session/update events emitted by official agy_acp_server
            const outcome = await processManager.prompt(
              sessionId!,
              promptBlocks,
              (update: any) => {
                send({
                  type: "update",
                  sessionId,
                  update,
                });
              }
            );

            send({ type: "done", sessionId, outcome });
          } catch (err: any) {
            send({
              type: "error",
              sessionId,
              message: err.message || "Official ACP execution error",
            });
          } finally {
            clearInterval(pingInterval);
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
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  },
});

const gracefulShutdown = async () => {
  console.log("\n[Server] Shutting down cleanly...");
  await processManager.shutdown();
  process.exit(0);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

console.log(`[Server] Official Antigravity ACP HTTP & SSE server running at http://localhost:${PORT}`);
