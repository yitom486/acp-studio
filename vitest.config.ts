import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
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
