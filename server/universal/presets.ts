import type { AgentProfile } from "./types";

/**
 * Built-in agent presets (ACP v1 stdio).
 * Users can override / extend via ACP_AGENTS_JSON env or POST /api/universal/agents.
 *
 * References:
 * - codex: `npx -y @agentclientprotocol/codex-acp` (needs OPENAI_API_KEY or ChatGPT auth)
 * - gemini: `gemini --acp`  | claude: `npx -y @agentclientprotocol/claude-agent-acp`
 * - opencode: `npx -y opencode-ai acp` | copilot: `copilot --acp --stdio`
 */
function npxArgs(pkg: string, extra: string[] = []): string[] {
  return ["-y", pkg, ...extra];
}

export const BUILTIN_AGENTS: AgentProfile[] = [
  {
    id: "codex",
    name: "codex-acp",
    title: "Codex",
    description: "OpenAI Codex via @agentclientprotocol/codex-acp (stdio). Supports modes, models, slash commands.",
    homepage: "https://github.com/agentclientprotocol/codex-acp",
    builtin: true,
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: npxArgs("@agentclientprotocol/codex-acp"),
    env: {},
  },
  {
    id: "antigravity-stdio",
    name: "antigravity-acp-stdio",
    title: "Antigravity (stdio)",
    description: "Local Antigravity ACP stdio server (server/acp-stdio.ts). Keeps existing agy flow but via universal gateway.",
    homepage: "https://antigravity.google",
    builtin: true,
    command: process.platform === "win32" ? "bun.exe" : "bun",
    args: ["run", "server/acp-stdio.ts"],
    env: {},
  },
  {
    id: "gemini",
    name: "gemini-acp",
    title: "Gemini CLI",
    description: "Google Gemini CLI ACP mode.",
    builtin: true,
    command: process.platform === "win32" ? "gemini.cmd" : "gemini",
    args: ["--acp"],
    env: {},
  },
  {
    id: "claude",
    name: "claude-agent-acp",
    title: "Claude Code",
    description: "Claude Code via @agentclientprotocol/claude-agent-acp.",
    builtin: true,
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: npxArgs("@agentclientprotocol/claude-agent-acp"),
    env: {},
  },
  {
    id: "opencode",
    name: "opencode-acp",
    title: "OpenCode",
    description: "OpenCode ACP mode.",
    builtin: true,
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: npxArgs("opencode-ai", ["acp"]),
    env: {},
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
  },
  {
    id: "cursor",
    name: "cursor-agent-acp",
    title: "Cursor",
    description: "Cursor CLI ACP mode.",
    builtin: true,
    command: process.platform === "win32" ? "cursor-agent.cmd" : "cursor-agent",
    args: ["acp"],
    env: {},
  },
];

export function resolveBuiltin(id: string): AgentProfile | undefined {
  return BUILTIN_AGENTS.find((a) => a.id === id);
}

/** Parse ACP_AGENTS_JSON env: [{id,command,args,env,...}] merged over builtins. */
export function loadExtraProfilesFromEnv(): AgentProfile[] {
  const raw = process.env.ACP_AGENTS_JSON;
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x && x.id && x.command).map((x) => ({
      id: String(x.id),
      name: String(x.name || x.id),
      title: String(x.title || x.id),
      description: x.description,
      command: String(x.command),
      args: Array.isArray(x.args) ? x.args.map(String) : [],
      env: x.env && typeof x.env === "object" ? x.env : {},
      builtin: false,
    }));
  } catch {
    return [];
  }
}
