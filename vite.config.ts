import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
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
        target: "http://localhost:13005",
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
          // 编辑器（CodeMirror 6 + 语言包 + merge）随 EditorPane 懒加载
          // 语言包（@codemirror/lang-* + 对应 @lezer 语法）不并入，保持按扩展名懒加载
          if (/@codemirror\/(state|view|commands|language|search|autocomplete|merge|lint)\//.test(norm) || /@lezer\/(common|highlight|lr)\//.test(norm)) {
            return "codemirror";
          }
          // 文件树（react-arborist + react-dnd + react-window）
          if (norm.includes("react-arborist") || norm.includes("react-dnd") || norm.includes("dnd-core") || norm.includes("react-window") || norm.includes("/redux/")) {
            return "filetree";
          }
          // Milkdown / ProseMirror 不手动分组：它们只被懒加载的 MarkdownWysiwyg 引用，交给 Rollup 自动拆分，
          // 避免和 vendor-ui 共享的 remark/unified 依赖形成循环、被首屏预加载。
          // 公式（remark-math + rehype-katex + katex），遇到公式才加载
          if (norm.includes("remark-math") || norm.includes("rehype-katex") || norm.includes("micromark-extension-math") || norm.includes("mdast-util-math") || norm.includes("/katex/") || norm.includes("hast-util-from-html-isomorphic") || norm.includes("hast-util-from-dom") || norm.includes("hast-util-from-html") || norm.includes("hast-util-to-text")) {
            return "math";
          }
          // Preserve Mermaid's dynamic imports for individual diagram engines.
          // Grouping mermaid/d3/cytoscape/elk into one manual chunk makes the
          // first flowchart download and evaluate every supported diagram type.
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
          // assistant-ui chat runtime renders on every thread view: isolate it
          // for long-term caching (vendor-ui stays lean for the app shell).
          if (
            norm.includes("@assistant-ui") ||
            norm.includes("assistant-stream") ||
            norm.includes("assistant-cloud")
          ) {
            return "vendor-assistant";
          }
          // Remaining UI/data libs (query, state, markdown, motion, icons).
          if (
            norm.includes("@tanstack") ||
            norm.includes("/zustand/") ||
            norm.includes("framer-motion") ||
            norm.includes("lucide-react") ||
            norm.includes("@radix-ui") ||
            norm.includes("radix-ui") ||
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
