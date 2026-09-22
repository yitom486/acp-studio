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
    strictPort: true,
    watch: {
      ignored: [
        "**/scratch/**",
        "**/dist/**",
        "**/electron-dist/**",
        "**/release/**",
        "**/.tmp*/**",
        "**/*.bun-build*",
        "**/*.exe",
      ],
    },
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
  build: {
    // Main entry stays lean: heavy highlight/terminal deps are lazy-loaded
    // into their own chunks (see manualChunks + React.lazy in App.tsx).
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const norm = id.replace(/\\/g, "/");
          // Shiki grammars stay per-language lazy chunks (loaded on demand by
          // code-comparison's LANG_LOADERS) — never merged into one mega-chunk.
          if (norm.includes("@shikijs/langs/")) return undefined;
          // Shiki core + JS engine + themes + transformers collapse into one
          // on-demand chunk (no oniguruma WASM: we use the JS regex engine).
          if (norm.includes("/shiki/") || norm.includes("@shikijs")) {
            return "shiki";
          }
          // Integrated terminal (xterm + addons) loads with TerminalDrawer.
          if (norm.includes("@xterm")) {
            return "xterm";
          }
          // React runtime stays separate so it can be long-term cached.
          // NOTE: exact package-dir match only — a bare "/react/" substring
          // would also catch zustand/react/* (zustand's React bindings) and
          // create a vendor-react <-> vendor-ui circular chunk.
          if (
            /\/node_modules\/(\.bun\/[^/]+\/node_modules\/)?react\//.test(norm) ||
            /\/node_modules\/(\.bun\/[^/]+\/node_modules\/)?react-dom\//.test(norm) ||
            /\/node_modules\/(\.bun\/[^/]+\/node_modules\/)?scheduler\//.test(norm)
          ) {
            return "vendor-react";
          }
          // Remaining UI/data libs (query, state, markdown, motion, icons).
          if (
            norm.includes("@tanstack") ||
            norm.includes("/zustand/") ||
            norm.includes("framer-motion") ||
            norm.includes("lucide-react") ||
            norm.includes("@radix-ui") ||
            norm.includes("class-variance-authority") ||
            norm.includes("/clsx/") ||
            norm.includes("tailwind-merge") ||
            norm.includes("react-markdown") ||
            norm.includes("remark-") ||
            norm.includes("hast-") ||
            norm.includes("unified") ||
            norm.includes("vfile")
          ) {
            return "vendor-ui";
          }
          return undefined;
        },
      },
    },
  },
});
