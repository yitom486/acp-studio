import { setupEnv, PORT, buildApp, freePortIfOccupied, shutdownBridges } from "./gateway";

setupEnv();
freePortIfOccupied(PORT);

const app = buildApp();

const server = Bun.serve({
  port: PORT,
  idleTimeout: 0, // Disable idle timeout so server never exits
  fetch: app.fetch,
});

// Explicit keepalive timer to ensure Bun process never drains event loop when idle on Windows
const keepAliveTimer = setInterval(() => {}, 60_000);

const gracefulShutdown = async () => {
  console.log("\n[Server] Shutting down cleanly...");
  clearInterval(keepAliveTimer);
  server.stop(true);
  await shutdownBridges();
  process.exit(0);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

console.log(`[Server] Google Antigravity ACP Studio server running at http://localhost:${PORT}`);
