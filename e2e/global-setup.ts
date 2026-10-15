import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Every entry point (including direct Playwright invocations) tests fresh builds.
export default function globalSetup() {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const bun = process.platform === "win32" ? "bun.exe" : "bun";
  for (const script of ["build", "build:electron"]) {
    execFileSync(bun, ["run", script], { cwd, stdio: "inherit", windowsHide: true });
  }
}
