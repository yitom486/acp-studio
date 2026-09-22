import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5188,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://localhost:3004",
        changeOrigin: true,
        ws: false,
        configure: (proxy) => {
          proxy.on("error", (err: any, _req: any, res: any) => {
            if (err.code === "ECONNRESET" || err.message?.includes("ECONNRESET")) {
              // Benign reset when downstream client cancels or completes SSE
              return;
            }
            if (err.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
              // Gateway server is still starting or restarting; respond gracefully so terminal is not flooded
              if (res && !res.headersSent && typeof res.writeHead === "function") {
                res.writeHead(503, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Gateway server not ready yet (ECONNREFUSED)" }));
              }
              return;
            }
            console.error("[Vite Proxy Error]", err.message || err);
          });
        },
      },
    },
  },
});
