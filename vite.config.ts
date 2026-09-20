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
          proxy.on("error", (err: any) => {
            if (err.code === "ECONNRESET" || err.message?.includes("ECONNRESET")) {
              // Benign reset when downstream client cancels or completes SSE
              return;
            }
            console.error("[Vite Proxy Error]", err.message || err);
          });
        },
      },
    },
  },
});
