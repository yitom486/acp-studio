/**
 * Node.js entry for the same gateway (used by Electron main).
 * Run: `node server/node.ts` (Node 22.6+ strips types natively).
 */
import { serve } from "@hono/node-server";
import { setupEnv, PORT, buildApp, freePortIfOccupied, shutdownBridges } from "./gateway";

setupEnv();
freePortIfOccupied(PORT);

const app = buildApp();

const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`[Server] Google Antigravity ACP Studio server running at http://localhost:${info.port} (node)`);
  }
);

// Never cut long-lived SSE streams: disable HTTP timeouts.
const netServer = server as unknown as {
  requestTimeout: number;
  headersTimeout: number;
  close: (cb?: () => void) => void;
};
netServer.requestTimeout = 0;
netServer.headersTimeout = 0;

const gracefulShutdown = async () => {
  console.log("\n[Server] Shutting down cleanly...");
  netServer.close();
  await shutdownBridges();
  process.exit(0);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
