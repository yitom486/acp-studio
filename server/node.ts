/**
 * Node.js entry for the same gateway (used by Electron main).
 * Run: `node server/node.ts` (Node 22.6+ strips types natively).
 */
import { serve } from "@hono/node-server";
import { setupEnv, PORT, buildApp, freePortIfOccupied, shutdownBridges } from "./gateway";
import { gatewayTokenPreview } from "./universal/security";

setupEnv();
freePortIfOccupied(PORT);

const app = buildApp();

const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
    hostname: "127.0.0.1", // 安全边界第一层：只绑回环，局域网不可达（纵深防御见 universal/security.ts）。
  },
  (info) => {
    console.log(`[Server] Google Antigravity ACP Studio server running at http://127.0.0.1:${info.port} (node)`);
    // 只打印前8位+掩码，完整 token 仅存 ~/.acp-studio/.gateway-token，不打全量进日志。
    console.log(`[Server] gateway token: ${gatewayTokenPreview()} (full token in ~/.acp-studio/.gateway-token)`);
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
