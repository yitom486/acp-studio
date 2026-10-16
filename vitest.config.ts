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
    // Many suites spawn native ACP/PowerShell/WSL processes. Unbounded Windows
    // workers contend on UNC discovery and can make unrelated suites time out.
    maxWorkers: process.platform === "win32" ? 4 : undefined,
    // Windows CI 上关闭 PowerShell 子进程 / 删临时目录较慢，钩子默认 10s 不够
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
