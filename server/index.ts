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
import * as fs from "node:fs";
import * as path from "node:path";

const ACP_IMAGE_NAMES = ["agy_acp_server.exe", "localharness_external.exe"];
const OWN_SERVER_IMAGES = ["agy_acp_server.exe", "localharness_external.exe", "bun.exe", "node.exe"];

/** Query Win32_Process for the candidate image names; returns pid/ppid/start-time. */
function queryAgyProcessTree(): { pid: number; ppid: number; startedAt: number; image: string }[] {
  if (process.platform !== "win32") return [];
  const filter = ACP_IMAGE_NAMES.map((n) => `Name='${n}'`).join(" OR ");
  const ps = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress`;
  try {
    const raw = execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
      encoding: "utf8",
    }).trim();
    if (!raw) return [];
    const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)];
    return arr.map((e: any) => ({
      pid: Number(e.ProcessId),
      ppid: Number(e.ParentProcessId),
      startedAt: parseWmiDate(String(e.CreationDate)),
      image: String(e.Name),
    }));
  } catch {
    return [];
  }
}

function parseWmiDate(s: string): number {
  // "20260918190305.123456+480" -> epoch ms
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return 0;
  return new Date(
    `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
  ).getTime();
}

function getImageName(pid: number): string {
  try {
    const out = execSync(`tasklist /NH /FO CSV /FI "PID eq ${pid}"`, { encoding: "utf8" }).trim();
    const m = out.match(/^"([^"]+)"/);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function freePortIfOccupied(port: number) {
  if (process.platform !== "win32") return;
  try {
    const stdout = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: "utf8" });
    const lines = stdout.trim().split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (!pid || pid === String(process.pid) || pid === "0") continue;
      // Root-cause fix: only touch our own stack's images, never random apps.
      const image = getImageName(Number(pid));
      if (!OWN_SERVER_IMAGES.includes(image)) {
        console.log(`[Server] Port ${port} is held by foreign process PID ${pid} (${image}); leaving it alone.`);
        continue;
      }
      console.log(`[Server] Freeing lingering process PID ${pid} (${image}) on port ${port}...`);
      try {
        execSync(`taskkill /F /PID ${pid} 2>nul`);
      } catch {
        // ignore
      }
    }
  } catch {
    // Port is not occupied
  }
}

/**
 * Root-cause fix: only kill ACP instances whose parent process is already dead
 * (true orphans from a crashed/force-killed session). Healthy instances owned
 * by Zed or other clients keep a live parent and are never touched — this ends
 * the self-inflicted "Server exited with code 1" cycle from blanket /IM sweeps.
 */
function cleanOrphanedAgyProcesses() {
  if (process.platform !== "win32") return;
  try {
    const procs = queryAgyProcessTree();
    if (procs.length === 0) return;
    const live = new Set(procs.map((p) => p.pid));
    live.add(process.pid);
    for (const p of procs) {
      if (p.pid === process.pid) continue;
      if (!live.has(p.ppid)) {
        console.log(`[Server] Removing orphaned ${p.image} PID ${p.pid} (parent ${p.ppid} gone)...`);
        try {
          execSync(`taskkill /F /T /PID ${p.pid} 2>nul`);
        } catch {
          // ignore if already gone
        }
      }
    }
  } catch {
    // ignore on query failure
  }
}

cleanOrphanedAgyProcesses();
freePortIfOccupied(PORT);

/**
 * Sweep stale PyInstaller _MEI* extraction dirs left by force-killed
 * agy_acp_server.exe instances. Skips anything modified within the last 24h
 * (a live process holds its dir locked; deleting it would break the instance).
 */
function sweepStaleMeiDirs() {
  const dirs = [process.env.TEMP || process.env.TMP, path.join(process.cwd(), ".acp-tmp")].filter(
    Boolean
  ) as string[];
  const acpTmp = path.join(process.cwd(), ".acp-tmp");
  // Live-instance guard: a _MEI dir is owned by an instance that started at or
  // before the dir's mtime. Everything older than ALL live instances is residue.
  const liveStarts = queryAgyProcessTree()
    .map((p) => p.startedAt)
    .filter((t) => t > 0);
  for (const tmp of dirs) {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const entry of fs.readdirSync(tmp)) {
        if (!entry.startsWith("_MEI")) continue;
        const full = path.join(tmp, entry);
        try {
          const mtime = fs.statSync(full).mtimeMs;
          if (tmp === acpTmp) {
            // Our dedicated dir: precise rule — keep only if some live ACP
            // process could own it (started within 90s before the dir).
            if (liveStarts.some((t) => t <= mtime + 90_000)) continue;
          } else {
            // Shared system TEMP may host other apps' onefile dirs: age rule.
            if (mtime > cutoff) continue;
          }
          fs.rmSync(full, { recursive: true, force: true });
          console.log(`[Server] Removed stale PyInstaller extraction dir: ${full}`);
        } catch {
          // Locked by a live process or permission issue; skip
        }
      }
    } catch {
      // ignore
    }
  }
}
sweepStaleMeiDirs();

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
