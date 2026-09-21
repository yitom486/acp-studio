/**
 * Runtime-agnostic HTTP gateway (Bun.serve AND Node/Hono compatible).
 * All routes speak WinterCG Request/Response only — no Bun.* / node:http APIs.
 * Entries: server/index.ts (Bun) and server/node.ts (Node, for Electron).
 */
import { Hono } from "hono";
import { handleUniversal } from "./universal/routes";
import { universalRegistry } from "./universal/registry";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

export function setupEnv() {
  // Runtime-agnostic gateway environment hook.
}

export const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3004;

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err);
});

console.log("[Server] Initializing Universal ACP Studio Gateway...");

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

export function buildApp() {
  const app = new Hono();

  // Universal ACP gateway (generic stdio agents: codex, gemini, claude, ...)
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
  await universalRegistry.shutdown().catch(() => undefined);
}
