import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchAgents, sessionRpc, type AgentSummary } from "./universal-api";
import type { SessionItem } from "../components/universal/Sidebar";

export const acpKeys = {
  agents: ["universal", "agents"] as const,
  sessions: (agentId: string) => ["universal", "sessions", agentId] as const,
};

function normalizeSessions(res: any): SessionItem[] {
  const items = res?.sessions || [];
  return (Array.isArray(items) ? items : []).map((s: any) => ({
    sessionId: s.sessionId || s.id,
    title: s.title,
    cwd: s.cwd,
    updatedAt: s.updatedAt,
  }));
}

/** Server state: agent profiles + connection status (polls in background). */
export function useAgentsQuery() {
  return useQuery<AgentSummary[]>({
    queryKey: acpKeys.agents,
    queryFn: fetchAgents,
    refetchInterval: 15000,
    staleTime: 5000,
  });
}

/** Server state: session list of one agent. Disabled until connected. */
export function useSessionsQuery(agentId: string, enabled: boolean) {
  return useQuery<SessionItem[]>({
    queryKey: acpKeys.sessions(agentId),
    queryFn: () => sessionRpc(agentId, "list", {}).then(normalizeSessions),
    enabled,
    staleTime: 5000,
  });
}

export function invalidateAgents(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: acpKeys.agents });
}

export function invalidateSessions(qc: QueryClient, agentId: string) {
  void qc.invalidateQueries({ queryKey: acpKeys.sessions(agentId) });
}
