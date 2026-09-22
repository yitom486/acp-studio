import { createRequire } from "node:module";
import * as fs from "node:fs";
import type { AgentProfile } from "./types";

/**
 * Built-in agent presets (ACP v1 stdio) — shell principle:
 * every preset shells out to the vendor's OFFICIAL CLI entry point and
 * reuses the CLI's own local credentials (env passthrough + same HOME).
 * We never store secrets; log in once with the official CLI and the
 * gateway picks it up. See `authHint` per preset.
 *
 * Users can override / extend via ACP_AGENTS_JSON env, POST
 * /api/universal/agents, or ~/.acp-studio/agents.json (all persisted).
 */
/**
 * Antigravity bridge: compiled single-file exe only (no bun/TS fallback).
 * Missing exe fails fast at connect time via whichCommand + installHint.
 * The exe is CUI like codex's; entry flash is covered by Zed's
 * CREATE_NO_WINDOW (well-behaved) or dist/agy-headless.exe as command.
 */
export const ANTIGRAVITY_EXE_MISSING_HINT =
  "缺少 dist/agy-acp-win-x64.exe：请在 scratch/repos/yitom486-agy-acp-map 下跑 bun run build:exe 后重试（不再回退 bun/TS）。";
function resolveAntigravity(): { command: string; args: string[] } {
  const sep = process.platform === "win32" ? "\\" : "/";
  const devExe = `${process.cwd()}${sep}scratch${sep}repos${sep}yitom486-agy-acp-map${sep}dist${sep}agy-acp-win-x64.exe`;
  try {
    const meta = (import.meta as unknown as { url?: string })?.url;
    const req = meta ? createRequire(meta) : (globalThis as any).require;
    const pkgJson = req?.resolve?.("@yitom/agy-acp-map/package.json");
    if (pkgJson) {
      const dir = pkgJson.replace(/package\.json$/, "").replace(/\//g, sep);
      return { command: `${dir}dist${sep}agy-acp-win-x64.exe`, args: [] };
    }
  } catch {
    // ignore, use dev-layout path below
  }
  return { command: devExe, args: [] };
}

function resolveCursorCli(): { command: string; args: string[] } {
  const isWin = process.platform === "win32";
  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? `${process.env.USERPROFILE}\\AppData\\Local` : "");
    const directCmd = localAppData ? `${localAppData}\\cursor-agent\\agent.cmd` : "";
    if (directCmd && fs.existsSync(directCmd)) {
      return { command: directCmd, args: ["acp"] };
    }
    return { command: "agent.cmd", args: ["acp"] };
  }
  const home = process.env.HOME || "";
  const directBin = home ? `${home}/.local/bin/agent` : "";
  if (directBin && fs.existsSync(directBin)) {
    return { command: directBin, args: ["acp"] };
  }
  return { command: "agent", args: ["acp"] };
}

const npxArgs = (pkg: string, extra: string[] = []): string[] => ["-y", pkg, ...extra];

const npx = () => (process.platform === "win32" ? "npx.cmd" : "npx");

export function resolveNpxOrLocal(pkg: string, extra: string[] = []): { command: string; args: string[] } {
  try {
    const meta = (import.meta as unknown as { url?: string })?.url;
    const req = meta ? createRequire(meta) : (globalThis as any).require;
    const resolved = req?.resolve?.(pkg);
    if (resolved && fs.existsSync(resolved)) {
      return {
        command: process.execPath,
        args: [resolved, ...extra],
      };
    }
  } catch {
    // fallback to npx
  }
  return {
    command: npx(),
    args: npxArgs(pkg, extra),
  };
}

export const BUILTIN_AGENTS: AgentProfile[] = [
  {
    id: "codex",
    name: "codex-acp",
    title: "Codex",
    description: "OpenAI Codex via @agentclientprotocol/codex-acp (stdio). Supports modes, models, slash commands.",
    homepage: "https://github.com/agentclientprotocol/codex-acp",
    builtin: true,
    ...resolveNpxOrLocal("@agentclientprotocol/codex-acp"),
    env: {},
    authHint: "复用本地 ChatGPT 登录（~/.codex/auth.json）或 CODEX_API_KEY / OPENAI_API_KEY（环境透传）。",
    installHint: "npm i -g @agentclientprotocol/codex-acp，或先装 Codex CLI 并完成登录。",
  },
  {
    id: "antigravity-stdio",
    name: "antigravity-acp-stdio",
    title: "Antigravity (stdio)",
    description: "Antigravity ACP bridge, compiled single-file exe (no bun/TS at runtime).",
    homepage: "https://antigravity.google",
    builtin: true,
    ...resolveAntigravity(),
    env: {},
    authHint: "复用 Antigravity CLI 本地登录态（~/.gemini/），零额外配置。",
    installHint: ANTIGRAVITY_EXE_MISSING_HINT,
  },
  {
    id: "opencode",
    name: "opencode-acp",
    title: "OpenCode",
    description: "OpenCode 原生 ACP 服务（opencode acp，stdio）。模型/会话与终端行为和 TUI 一致。",
    homepage: "https://opencode.ai/docs/acp/",
    builtin: true,
    command: process.platform === "win32" ? "opencode.exe" : "opencode",
    args: ["acp"],
    env: {},
    authHint: "复用 `opencode auth login` 存到 ~/.local/share/opencode/auth.json 的各 provider 凭证（环境变量优先透传）。",
    installHint: "npm i -g opencode-ai（或 bun add -g opencode-ai），然后跑一次 `opencode auth login`。",
  },
  {
    id: "cursor-cli",
    name: "cursor-agent",
    title: "Cursor CLI",
    description: "Cursor 官方 CLI 的原生 ACP 模式（agent acp，stdio）。",
    homepage: "https://cursor.com/docs/cli/acp",
    builtin: true,
    ...resolveCursorCli(),
    env: {},
    authHint: "已自动复用本地 Cursor 登录态（未登录可运行 `agent login`）。",
    installHint: "已自动安装在 %LOCALAPPDATA%\\cursor-agent。若需手动安装请在终端执行 `irm https://cursor.com/install?win32=true | iex`。",
  },
  {
    id: "deepseek",
    name: "dsh-acp",
    title: "DeepSeek Harness",
    description: "DeepSeek Harness 自动化 ACP 服务（dsh --profile acp，stdio）。authMethods 为空，靠 harness 自身凭证。",
    homepage: "https://deepseekdocs.com/en/docs/guides/acp-automation-server",
    builtin: true,
    command: npx(),
    args: ["-y", "@deepseek-ai/dsh", "--profile", "acp"],
    env: {},
    authHint: "无 ACP 登录（authMethods 为空）：靠 harness 自身凭证（DEEPSEEK_API_KEY / harness 配置），全部留在官方位置。",
    installHint: "npm i -g @deepseek-ai/dsh（需 Node 22.19+ 或 24+），或 npx 即用。注意 preview 版变化快，建议 pin 版本。",
  },
  {
    id: "gemini",
    name: "gemini-acp",
    title: "Gemini CLI",
    description: "Google Gemini CLI ACP 模式。",
    builtin: true,
    command: process.platform === "win32" ? "gemini.cmd" : "gemini",
    args: ["--acp"],
    env: {},
    authHint: "复用 Gemini CLI 本地登录态。",
    installHint: "按 https://github.com/google-gemini/gemini-cli 装好并登录一次。",
  },
  {
    id: "claude",
    name: "claude-agent-acp",
    title: "Claude Code",
    description: "Claude Code via @agentclientprotocol/claude-agent-acp。",
    builtin: true,
    ...resolveNpxOrLocal("@agentclientprotocol/claude-agent-acp"),
    env: {},
    authHint: "复用本地 Claude Code 登录态或 ANTHROPIC_API_KEY（环境透传）。",
    installHint: "先装好 Claude Code 并完成一次登录。",
  },
  {
    id: "copilot",
    name: "copilot-acp",
    title: "Copilot CLI",
    description: "GitHub Copilot CLI ACP stdio mode.",
    builtin: true,
    command: process.platform === "win32" ? "copilot.cmd" : "copilot",
    args: ["--acp", "--stdio"],
    env: {},
    authHint: "复用 Copilot CLI 本地 GitHub 登录态。",
    installHint: "装好 Copilot CLI 并完成一次登录（需支持 ACP stdio 的新版本）。",
  },
];

export function resolveBuiltin(id: string): AgentProfile | undefined {
  return BUILTIN_AGENTS.find((a) => a.id === id);
}

function toProfile(x: any): AgentProfile | null {
  if (!x || !x.id || !x.command) return null;
  return {
    id: String(x.id),
    name: String(x.name || x.id),
    title: String(x.title || x.id),
    description: x.description,
    homepage: x.homepage,
    command: String(x.command),
    args: Array.isArray(x.args) ? x.args.map(String) : [],
    env: x.env && typeof x.env === "object" ? x.env : {},
    defaultCwd: x.defaultCwd,
    authHint: x.authHint,
    installHint: x.installHint,
    builtin: false,
  };
}

/** Parse ACP_AGENTS_JSON env: [{id,command,args,env,...}] merged over builtins. */
export function loadExtraProfilesFromEnv(): AgentProfile[] {
  const raw = process.env.ACP_AGENTS_JSON;
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(toProfile).filter((p): p is AgentProfile => !!p);
  } catch {
    return [];
  }
}

export function parseProfilesJson(raw: unknown): AgentProfile[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map(toProfile).filter((p): p is AgentProfile => !!p);
}
