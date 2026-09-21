import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentProfile, AgentStatus } from "./types";
import { BUILTIN_AGENTS, loadExtraProfilesFromEnv, resolveBuiltin, parseProfilesJson } from "./presets";
import { UniversalAgentConnection } from "./AgentConnection";

/** User custom profiles live here (override with ACP_AGENTS_FILE). */
export function customAgentsFile(): string {
  return process.env.ACP_AGENTS_FILE || path.join(os.homedir(), ".acp-studio", "agents.json");
}

function loadCustomProfilesFromFile(): AgentProfile[] {
  try {
    const file = customAgentsFile();
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return parseProfilesJson(raw);
  } catch {
    return [];
  }
}

/**
 * Registry of agent profiles + live stdio connections.
 * One connection per agent id (shared across sessions, like Zed).
 * Sources (later wins): builtins → ACP_AGENTS_JSON env → ~/.acp-studio/agents.json.
 */
export class UniversalRegistry {
  private profiles = new Map<string, AgentProfile>();
  private conns = new Map<string, UniversalAgentConnection>();

  constructor() {
    for (const p of BUILTIN_AGENTS) this.profiles.set(p.id, { ...p });
    for (const p of loadExtraProfilesFromEnv()) this.profiles.set(p.id, p);
    for (const p of loadCustomProfilesFromFile()) this.profiles.set(p.id, { ...p, builtin: false });
  }

  /** Re-read env + file customs (tests / external edits). Drops in-memory customs. */
  reloadCustomProfiles(): void {
    for (const [id, p] of this.profiles) {
      if (!p.builtin) this.profiles.delete(id);
    }
    for (const p of loadExtraProfilesFromEnv()) this.profiles.set(p.id, p);
    for (const p of loadCustomProfilesFromFile()) this.profiles.set(p.id, { ...p, builtin: false });
  }

  listProfiles(): AgentProfile[] {
    return [...this.profiles.values()].map((p) => ({ ...p, env: undefined, args: p.args }));
  }

  /** full profile incl. env for internal use only */
  getProfile(id: string): AgentProfile | undefined {
    return this.profiles.get(id);
  }

  private saveCustomProfiles(): void {
    try {
      const customs = [...this.profiles.values()].filter((p) => !p.builtin);
      const file = customAgentsFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(customs, null, 2));
    } catch {
      // persistence is best-effort; in-memory registry keeps working
    }
  }

  upsertProfile(p: AgentProfile): AgentProfile {
    if (!p.id || !p.command) throw new Error("profile id + command required");
    const prev = this.profiles.get(p.id);
    const merged: AgentProfile = {
      id: p.id,
      name: p.name || p.id,
      title: p.title || p.id,
      description: p.description ?? prev?.description,
      homepage: p.homepage ?? prev?.homepage,
      command: p.command,
      args: p.args || [],
      env: p.env || {},
      defaultCwd: p.defaultCwd ?? prev?.defaultCwd,
      authHint: p.authHint ?? prev?.authHint,
      installHint: p.installHint ?? prev?.installHint,
      builtin: prev?.builtin ?? false,
    };
    this.profiles.set(p.id, merged);
    // Drop a stale connection so the next connect() picks up the new profile.
    const c = this.conns.get(p.id);
    if (c) {
      void c.disconnect().catch(() => undefined);
      this.conns.delete(p.id);
    }
    this.saveCustomProfiles();
    return merged;
  }

  removeProfile(id: string): boolean {
    const p = this.profiles.get(id);
    if (!p || p.builtin) return false;
    this.profiles.delete(id);
    const c = this.conns.get(id);
    if (c) {
      void c.disconnect().catch(() => undefined);
      this.conns.delete(id);
    }
    this.saveCustomProfiles();
    return true;
  }

  connFor(id: string): UniversalAgentConnection {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error(`Unknown agent '${id}'. Available: ${[...this.profiles.keys()].join(", ")}`);
    // Re-resolve builtin base each time (handles bun/npx path drift),
    // but user customizations of the same id always win.
    const freshBuiltin = resolveBuiltin(id);
    const effective: AgentProfile = freshBuiltin
      ? { ...freshBuiltin, ...profile, env: { ...(freshBuiltin.env || {}), ...(profile.env || {}) } }
      : profile;
    let c = this.conns.get(id);
    if (!c || c.profile.id !== id) {
      c = new UniversalAgentConnection(effective);
      this.conns.set(id, c);
    } else {
      // keep custom env overrides live
      (c as unknown as { profile: AgentProfile }).profile = effective;
    }
    return c;
  }

  statuses(): AgentStatus[] {
    return [...this.profiles.keys()].map((id) => {
      const c = this.conns.get(id);
      if (!c) return { id, connected: false, pid: null, protocolVersion: null, agentInfo: null, agentCapabilities: null, authMethods: null, authStatus: null, meta: null, lastError: null, startedAt: null };
      return c.status() as AgentStatus;
    });
  }

  async shutdown(): Promise<void> {
    for (const c of this.conns.values()) {
      await c.disconnect().catch(() => undefined);
    }
    this.conns.clear();
  }
}

export const universalRegistry = new UniversalRegistry();
