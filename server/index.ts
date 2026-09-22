import { setupEnv, PORT, buildApp, freePortIfOccupied, shutdownBridges } from "./gateway";
import { gatewayTokenPreview } from "./universal/security";

setupEnv();
freePortIfOccupied(PORT);

const app = buildApp();

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // 安全边界第一层：只绑回环，局域网不可达（纵深防御见 universal/security.ts）。
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

console.log(`[Server] Google Antigravity ACP Studio server running at http://127.0.0.1:${PORT}`);
// 只打印前8位+掩码：完整 token 仅存 ~/.acp-studio/.gateway-token（ACP_GATEWAY_TOKEN 可覆盖），
// 禁止打全量进日志（本地调试如需全文请直接读该文件）。
console.log(`[Server] gateway token: ${gatewayTokenPreview()} (full token in ~/.acp-studio/.gateway-token)`);
