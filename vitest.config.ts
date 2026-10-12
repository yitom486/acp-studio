import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    // Windows CI 上关闭 PowerShell 子进程 / 删临时目录较慢，钩子默认 10s 不够
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
