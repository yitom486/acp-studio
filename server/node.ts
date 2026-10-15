/**
 * Node.js entry for the same gateway (used by Electron main).
 * Run: `node server/node.ts` (Node 22.6+ strips types natively).
 */
import { serve } from "@hono/node-server";
import { setupEnv, PORT, buildApp, freePortIfOccupied, shutdownBridges } from "./gateway";
import { gatewayBootstrapUrl, gatewayTokenPreview } from "./universal/security";
import { attachPtyUpgrade } from "./universal/pty";
import { startMcpUiServer } from "./universal/mcp-ui-server";

setupEnv();
await freePortIfOccupied(PORT);

// Start dedicated 5-digit MCP Server (auto-cascade starting from 13920)
await startMcpUiServer().catch((err) => {
  console.warn(`[Server] 启动 MCP UI 端口服务失败: ${(err as Error)?.message || err}`);
});

const app = buildApp();

const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
    hostname: "127.0.0.1", // 安全边界第一层：只绑回环，局域网不可达（纵深防御见 universal/security.ts）。
  },
  (info) => {
    console.log(`[Server] Google Antigravity ACP Studio server running at http://127.0.0.1:${info.port} (node)`);
    console.log(`[Server] gateway token: ${gatewayTokenPreview()} (full token in ~/.acp-studio/.gateway-token)`);
    // 所有 /api/universal/* 都要 token：浏览器模式用一次性链接打开 UI（只打到本机终端）。
    console.log(`[Server] open the UI with:  ${gatewayBootstrapUrl(`http://127.0.0.1:${info.port}`)}`);
  }
);

// Never cut long-lived SSE streams: disable HTTP timeouts.
const netServer = server as unknown as {
  requestTimeout: number;
  headersTimeout: number;
  close: (cb?: () => void) => void;
  on: (event: string, listener: (...args: never[]) => void) => void;
};
netServer.requestTimeout = 0;
netServer.headersTimeout = 0;

// 真 PTY 的 WS 升级（Bun 入口 server/index.ts 不挂：Bun 下无 node-pty）。
void attachPtyUpgrade(netServer as never);

const gracefulShutdown = async () => {
  console.log("\n[Server] Shutting down cleanly...");
  netServer.close();
  await shutdownBridges();
  process.exit(0);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
