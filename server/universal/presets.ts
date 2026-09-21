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
function npxArgs(pkg: string, extra: string[] = []): string[] {
  return ["-y", pkg, ...extra];
}

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
    description: "Official Antigravity ACP stdio server via @yitom/agy-acp-map (sdk-server.ts).",
    homepage: "https://antigravity.google",
    builtin: true,
    command: process.platform === "win32" ? "bun.exe" : "bun",
    args: ["run", "scratch/repos/yitom486-agy-acp-map/src/sdk-server.ts"],
    env: {},
    authHint: "复用 Antigravity CLI 本地登录态（~/.gemini/），零额外配置。",
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
    name: "cursor-cli-acp",
    title: "Cursor CLI",
    description: "Cursor 官方 CLI 的 ACP 模式（agent acp，stdio）。需先用官方 CLI 完成一次登录。",
    homepage: "https://cursor.com/docs/cli/acp",
    builtin: true,
    command: process.platform === "win32" ? "agent.exe" : "agent",
    args: ["acp"],
    env: {},
    authHint: "官方文档流程：先跑一次 `agent login`（凭证留在 Cursor CLI 自己的存储里）；或透传 CURSOR_API_KEY / CURSOR_AUTH_TOKEN，也可在命令前加参数。",
    installHint: "curl https://cursor.com/install | bash（默认落到 ~/.local/bin/agent，Windows 请确认 agent.exe 在 PATH 中）。",
  },
  {
    id: "cursor-adapter",
    name: "cursor-agent-acp",
    title: "Cursor (adapter)",
    description: "社区 ACP 适配器（cursor-agent-acp），桥接 cursor-agent CLI。官方 CLI 不可用时的备选。",
    homepage: "https://github.com/konsumer/cursor-agent-acp",
    builtin: true,
    ...resolveNpxOrLocal("cursor-agent-acp"),
    env: {},
    authHint: "复用 `cursor-agent login` 的本地登录（可用 CURSOR_AGENT_EXECUTABLE 覆盖二进制路径）。",
    installHint: "先装好 cursor-agent 并跑一次 `cursor-agent login`。",
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
