import type { AgentProfile, AgentStatus } from "./types";
import { BUILTIN_AGENTS, loadExtraProfilesFromEnv, resolveBuiltin } from "./presets";
import { UniversalAgentConnection } from "./AgentConnection";

/**
 * Registry of agent profiles + live stdio connections.
 * One connection per agent id (shared across sessions, like Zed).
 */
export class UniversalRegistry {
  private profiles = new Map<string, AgentProfile>();
  private conns = new Map<string, UniversalAgentConnection>();

  constructor() {
    for (const p of BUILTIN_AGENTS) this.profiles.set(p.id, { ...p });
    for (const p of loadExtraProfilesFromEnv()) this.profiles.set(p.id, p);
  }

  listProfiles(): AgentProfile[] {
    return [...this.profiles.values()].map((p) => ({ ...p, env: undefined, args: p.args }));
  }

  /** full profile incl. env for internal use only */
  getProfile(id: string): AgentProfile | undefined {
    return this.profiles.get(id);
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
      builtin: prev?.builtin ?? false,
    };
    this.profiles.set(p.id, merged);
    return merged;
  }

  removeProfile(id: string): boolean {
    const p = this.profiles.get(id);
    if (!p || p.builtin) return false;
    this.profiles.delete(id);
    return true;
  }

  connFor(id: string): UniversalAgentConnection {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error(`Unknown agent '${id}'. Available: ${[...this.profiles.keys()].join(", ")}`);
    // Re-resolve builtin command each time (handles bun/npx path drift)
    const freshBuiltin = resolveBuiltin(id);
    const effective: AgentProfile = freshBuiltin
      ? { ...freshBuiltin, env: { ...(freshBuiltin.env || {}), ...(profile.env || {}) } }
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
