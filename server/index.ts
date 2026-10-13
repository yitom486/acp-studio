import { setupEnv, PORT, HOST, buildApp, freePortIfOccupied, shutdownBridges } from "./gateway";
import { gatewayBootstrapUrl, gatewayTokenPreview } from "./universal/security";

setupEnv();
freePortIfOccupied(PORT);

const app = buildApp();

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
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
console.log(`[Server] gateway token: ${gatewayTokenPreview()} (full token in ~/.acp-studio/.gateway-token)`);
// 所有 /api/universal/* 都要 token。浏览器模式用下面的一次性链接打开 UI（Jupyter 式，
// 前端读取后存 localStorage 并从地址栏抹掉）；只打到本机终端，不写入任何文件。
console.log(`[Server] open the UI with:  ${gatewayBootstrapUrl("http://localhost:5188")}  (vite dev)`);
console.log(`[Server]              or:  ${gatewayBootstrapUrl(`http://127.0.0.1:${PORT}`)}  (built dist)`);
// Antigravity quota live probe updated

