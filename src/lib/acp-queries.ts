import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchAgents, sessionRpc, getWorkspaceDefault, providersRpc, gitStatus, gitFile, type AgentSummary } from "@/lib/universal-api";
import type { SessionItem } from "@/components/universal/Sidebar";

export const acpKeys = {
  agents: ["universal", "agents"] as const,
  sessions: (agentId: string) => ["universal", "sessions", agentId] as const,
  workspaceDefault: ["universal", "workspace", "default"] as const,
  providers: (agentId: string) => ["universal", "providers", agentId] as const,
  gitStatus: (cwd: string) => ["universal", "git", "status", cwd] as const,
  gitFile: (cwd: string, file: string) => ["universal", "git", "file", cwd, file] as const,
};

export function normalizeSessions(res: any): SessionItem[] {
  const items = res?.sessions || [];
  return (Array.isArray(items) ? items : []).map((s: any) => ({
    sessionId: s.sessionId || s.id,
    title: s.title,
    cwd: s.cwd,
    updatedAt: s.updatedAt,
    origin: s.origin,
    kind: s.kind,
    parentSessionId: s.parentSessionId,
    _meta: s._meta,
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

/** App-managed references remain available even when the native agent is disconnected. */
export function useSessionsQuery(agentId: string, enabled: boolean) {
  return useQuery<SessionItem[]>({
    queryKey: acpKeys.sessions(agentId),
    queryFn: () => sessionRpc(agentId, "history", {}).then(normalizeSessions),
    enabled: !!agentId,
    staleTime: 5000,
    refetchInterval: 5000,
  });
}

/** Gateway default workspace (rarely changes; shared by App + TerminalDrawer). */
export function useWorkspaceDefaultQuery(enabled = true) {
  return useQuery({
    queryKey: acpKeys.workspaceDefault,
    queryFn: getWorkspaceDefault,
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/** Provider rows of one agent. Disabled until the modal opens. */
export function useProvidersQuery(agentId: string, enabled: boolean) {
  return useQuery({
    queryKey: acpKeys.providers(agentId),
    queryFn: () => providersRpc(agentId, "list", {}),
    enabled: enabled && !!agentId,
    staleTime: 5000,
  });
}

/** Git working-tree status of one cwd. Disabled until the modal opens. */
export function useGitStatusQuery(cwd: string | null, enabled: boolean) {
  return useQuery({
    queryKey: acpKeys.gitStatus(cwd ?? ""),
    queryFn: () => gitStatus(cwd as string),
    enabled: enabled && !!cwd,
    staleTime: 5000,
  });
}

/** Diff detail of one file. Disabled until a file is selected. */
export function useGitFileQuery(cwd: string | null, file: string | null, enabled: boolean) {
  return useQuery({
    queryKey: acpKeys.gitFile(cwd ?? "", file ?? ""),
    queryFn: () => gitFile(cwd as string, file as string),
    enabled: enabled && !!cwd && !!file,
    staleTime: 5000,
  });
}

export function invalidateAgents(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: acpKeys.agents });
}

export function invalidateProviders(qc: QueryClient, agentId: string) {
  void qc.invalidateQueries({ queryKey: acpKeys.providers(agentId) });
}

export function invalidateGit(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["universal", "git"], exact: false });
}

export function invalidateSessions(qc: QueryClient, agentId: string) {
  void qc.invalidateQueries({ queryKey: acpKeys.sessions(agentId) });
}
