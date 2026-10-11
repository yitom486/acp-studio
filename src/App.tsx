import React, { Suspense, lazy, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AcpAssistantProvider } from "@/components/assistant/AcpAssistantProvider";
import { AcpComposer } from "@/components/assistant/AcpComposer";
import { AssistantChatView } from "@/components/assistant/AssistantChatView";
import { matchPermToToolCalls } from "@/lib/acp-assistant";
import { StudioHeader } from "@/components/universal/StudioHeader";
import { Sidebar } from "@/components/universal/Sidebar";
import { PermissionDialog } from "@/components/universal/PermissionDialog";
import { ElicitationCard } from "@/components/universal/ElicitationCard";
import { Skeleton } from "@/components/ui/skeleton";
import { TitleBar } from "@/components/universal/TitleBar";
import { useStudioStore, useStudioShallow } from "@/stores/useStudioStore";
import { useAgentsQuery, useSessionsQuery, invalidateAgents, invalidateSessions } from "@/lib/acp-queries";
import {
  logoutAgent,
  sessionRpc,
  findConfigOption,
  type AgentSummary,
} from "@/lib/universal-api";
import {
  useAppBootAndShortcuts,
  useAgentConfig,
  useSessionLifecycle,
  useChatSend,
} from "@/hooks";

/**
 * Heavy modals/drawers are code-split so the first paint only ships the
 * shell (Sidebar/Header/Chat/Composer). Each chunk loads on demand via
 * Suspense; failures are loud (console.error) and surface through the root
 * ErrorBoundary instead of a blank screen.
 */
function lazyModal(name: string, loader: () => Promise<React.ComponentType<any>>) {
  return lazy(() =>
    loader()
      .then((comp) => ({ default: comp }))
      .catch((err) => {
        console.error(`[App] lazy chunk "${name}" failed to load:`, err);
        throw err;
      })
  );
}

const SessionSettingsModal = lazyModal(
  "SessionSettingsModal",
  () => import("@/components/universal/SessionSettingsModal").then((m) => m.SessionSettingsModal as any)
);
const ProvidersModal = lazyModal(
  "ProvidersModal",
  () => import("@/components/universal/ProvidersModal").then((m) => m.ProvidersModal as any)
);
const UniversalAuthModal = lazyModal(
  "UniversalAuthModal",
  () => import("@/components/universal/AuthModal").then((m) => m.UniversalAuthModal as any)
);
const CustomAgentModal = lazyModal(
  "CustomAgentModal",
  () => import("@/components/universal/CustomAgentModal").then((m) => m.CustomAgentModal as any)
);
const GitChangesModal = lazyModal(
  "GitChangesModal",
  () => import("@/components/universal/GitChangesModal").then((m) => m.GitChangesModal as any)
);
const TerminalDrawer = lazyModal(
  "TerminalDrawer",
  () => import("@/components/universal/TerminalDrawer").then((m) => m.TerminalDrawer as any)
);
const ModelBrowserModal = lazyModal(
  "ModelBrowserModal",
  () => import("@/components/universal/ModelBrowserModal").then((m) => m.ModelBrowserModal as any)
);

/** Suspense placeholder for lazily loaded modals/drawers. */
function LazyModalFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="w-full max-w-md space-y-2 rounded-2xl border border-border bg-card p-4">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
      </div>
    </div>
  );
}

/**
 * ACP Studio Universal — full ACP v1 client.
 * Decoupled controller layer via focused hooks:
 * 1. useAppBootAndShortcuts: theme, thread restore, agent validation, trailing snapshot, hotkeys.
 * 2. useAgentConfig: model config, fallback model, preferences migration, discovery.
 * 3. useSessionLifecycle: resume-first session resolution, race-condition guard, open/fork/delete.
 * 4. useChatSend: streaming orchestration, wall-clock timing, permissions & elicitations.
 *
 * Re-render discipline: this shell subscribes via `useStudioShallow`, which
 * excludes `messages`. Streaming chunks therefore re-render only the
 * transcript leaves, not the whole layout.
 */
export default function App() {
  const qc = useQueryClient();
  const agentsRef = useRef<AgentSummary[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const s = useStudioShallow();

  // Server state (TanStack Query)
  const agentsQuery = useAgentsQuery();
  const agents = agentsQuery.data ?? [];
  const activeAgent = agents.find((a) => a.id === s.activeAgentId);
  const connected = !!activeAgent?.status?.connected;
  const sessionsQuery = useSessionsQuery(s.activeAgentId, connected);
  const sessions = sessionsQuery.data ?? [];
  const sessionCwd = sessions.find((x) => x.sessionId === s.sessionId)?.cwd || null;
  const effectiveCwd = s.currentWorkspace || sessionCwd;

  const caps = (activeAgent?.status?.agentCapabilities || {}) as any;
  const sessionCaps = (caps.sessionCapabilities || {}) as Record<string, unknown>;
  const promptCaps = (caps.promptCapabilities || {}) as Record<string, unknown>;
  const mcpCaps = (caps.mcpCapabilities || {}) as Record<string, unknown>;
  const supportsList = "list" in sessionCaps;
  const supportsFork = "fork" in sessionCaps;
  const supportsProviders = !!caps.providers;
  const supportsAdditionalDirs = "additionalDirectories" in sessionCaps;
  const supportImage = !!promptCaps.image;

  // 1. Boot initialization & global shortcuts
  useAppBootAndShortcuts({
    agents,
    agentsRef,
    activeAgentId: s.activeAgentId,
    sessionId: s.sessionId,
    activeThreadId: s.activeThreadId,
    currentWorkspace: s.currentWorkspace,
  });

  // Dynamic forward-reference for ensureSession between useAgentConfig & useSessionLifecycle
  const ensureSessionRef = useRef<(agentId?: string, force?: boolean) => Promise<string | null>>(async () => null);

  // 2. Agent configuration & model preferences
  const {
    applyDefaultConfigOptions,
    setSessionConfig,
    handleFallbackModel,
    handleApplyModel,
    handleDiscoverModels,
  } = useAgentConfig({
    agentsRef,
    ensureSession: (agentId, force) => ensureSessionRef.current(agentId, force),
  });

  // Forward ref for abortRef in session lifecycle (e.g. aborting on agent switch)
  const abortRefProxy = useRef<AbortController | null>(null);

  // 3. Session lifecycle & resume-first resolution
  const {
    ensureSession,
    resolveSession,
    handleSelectAgent,
    handleConnect,
    handleCreateSession,
    handleOpenSession,
    handleForkSession,
    handleDeleteSession,
    handleCleanupEmpty,
    cleaningEmpty,
  } = useSessionLifecycle({
    qc,
    agents,
    agentsRef,
    applyDefaultConfigOptions,
    abortRef: abortRefProxy,
  });
  ensureSessionRef.current = ensureSession;

  // 4. Chat turn execution & streaming
  const {
    abortRef,
    handleSend,
    handleStop,
    handlePermRespond,
    handleElicRespond,
  } = useChatSend({
    qc,
    agentsRef,
    resolveSession,
  });
  abortRefProxy.current = abortRef.current;

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden select-text">
      {/* Layer 1: Clean Window TitleBar */}
      <TitleBar />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar
          agents={agents}
          activeAgentId={s.activeAgentId}
          onSelectAgent={handleSelectAgent}
          onConnectAgent={handleConnect}
          connectingId={s.connectingId}
          cleaningEmpty={cleaningEmpty}
          onCleanupEmpty={handleCleanupEmpty}
          authOk={s.authOk}
          sessions={sessions}
          sessionsLoading={sessionsQuery.isFetching}
          activeSessionId={s.sessionId}
          onRefreshSessions={() => invalidateSessions(qc, s.activeAgentId)}
          onNewSession={() => s.setSettingsOpen(true)}
          onOpenSession={handleOpenSession}
          onForkSession={(item) => handleForkSession(item.sessionId)}
          onDeleteSession={handleDeleteSession}
          supportsFork={supportsFork}
          supportsList={supportsList}
          onOpenProviders={() => s.setProvidersOpen(true)}
          supportsProviders={supportsProviders}
          onManageCustom={() => setCustomOpen(true)}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Layer 2: Retained Lower Workbench Header */}
          <StudioHeader
            agents={agents}
            activeAgentId={s.activeAgentId}
            onSelectAgent={handleSelectAgent}
            onConnect={() => handleConnect()}
            connecting={s.connectingId === s.activeAgentId}
            onOpenAuth={() => s.setAuthOpen(true)}
            onLogout={async () => {
              try {
                await logoutAgent(s.activeAgentId);
                invalidateAgents(qc);
              } catch (e: any) {
                alert(`logout 失败: ${e.message}`);
              }
            }}
            authOk={s.authOk[s.activeAgentId] ?? null}
            sessionId={s.sessionId}
            sessionTitle={s.sessionInfo?.title}
            usage={s.usage}
            currentWorkspace={s.currentWorkspace}
            recentWorkspaces={s.recentWorkspaces}
            onSelectWorkspace={(p, name) => s.setWorkspace(p, name)}
            terminalOpen={s.terminalOpen}
            onToggleTerminal={() => s.setTerminalOpen(!s.terminalOpen)}
            hasChangesCwd={!!effectiveCwd}
            supportsFork={supportsFork}
            supportsProviders={supportsProviders}
            busy={s.busy || s.isStreaming}
            isStreaming={s.isStreaming}
            onNewSession={() => s.setSettingsOpen(true)}
            onForkSession={() => handleForkSession()}
            onOpenProviders={() => s.setProvidersOpen(true)}
            onOpenChanges={() => s.setGitChangesOpen(true)}
            onCloseSession={async () => {
              const cur = useStudioStore.getState();
              if (!cur.sessionId) return;
              await sessionRpc(cur.activeAgentId, "close", { sessionId: cur.sessionId }).catch((e: any) => alert(e.message));
              cur.setSessionId(null);
              invalidateSessions(qc, cur.activeAgentId);
            }}
            onDeleteSession={async () => {
              const cur = useStudioStore.getState();
              if (!cur.sessionId) return;
              if (!confirm(`删除会话 ${cur.sessionId}？`)) return;
              await sessionRpc(cur.activeAgentId, "delete", { sessionId: cur.sessionId }).catch((e: any) => alert(e.message));
              cur.setSessionId(null);
              cur.resetThread();
              invalidateSessions(qc, cur.activeAgentId);
            }}
            onClearMessages={() => !s.isStreaming && s.setMessages([])}
          />

          <PermissionDialog
            pending={s.pendingPerms.filter((p) => {
              if (s.sessionId && p.sessionId !== s.sessionId) return false;
              // 已在工具卡内联展示的不再进全局弹窗 (匹配器见 acp-assistant.ts)。
              // 用 getState imperative 读取 messages，避免 shell 订阅流式热路径。
              if (matchPermToToolCalls(p, useStudioStore.getState().messages, s.sessionId)) return false;
              return true;
            })}
            onRespond={handlePermRespond}
            respondingId={s.respondingId}
          />

          {s.pendingElic.length > 0 && (
            <div className="px-4 pt-2 space-y-2 max-h-64 overflow-y-auto shrink-0">
              {s.pendingElic.map((e) => (
                <ElicitationCard
                  key={e.elicitationId}
                  e={e}
                  onRespond={handleElicRespond}
                  busy={s.respondingId === e.elicitationId}
                />
              ))}
            </div>
          )}

          <AcpAssistantProvider onSend={(t) => handleSend(t)} onStop={handleStop}>
            <AssistantChatView
              onSelectSuggestion={(p) => handleSend(p)}
              agentName={activeAgent?.title || activeAgent?.name || "Agent"}
              onOpenDiff={(file) => s.setGitChangesOpen(true, file)}
              connected={connected}
              sessionId={s.sessionId}
              sessionError={s.sessionError}
              sessionLoading={s.sessionLoading}
              onEnsureSession={() => ensureSession()}
            />

            <AcpComposer
              onSendAttachmentOnly={() => handleSend("")}
              onClear={() => !s.isStreaming && s.setMessages([])}
              isStreaming={s.isStreaming}
              commands={s.availableCommands}
              supportImage={supportImage}
              attachments={s.attachments}
              setAttachments={(a) => s.setAttachments(a)}
              agentTitle={activeAgent?.title || s.activeAgentId}
              configOptions={s.configOptions}
              onSetConfig={(configId, value) => setSessionConfig(configId, value)}
              onBrowseModels={() => s.setModelsOpen(true)}
              hasModelCatalog={!!s.models}
              connected={connected}
              fallbackModels={s.models?.availableModels || null}
              fallbackCurrentModel={s.models?.currentModelId || ""}
              onFallbackModel={handleFallbackModel}
              onEnsureSession={() => ensureSession()}
              sessionLoading={s.sessionLoading}
            />
          </AcpAssistantProvider>
        </div>
      </div>

      <Suspense fallback={<LazyModalFallback />}>
        <UniversalAuthModal
          isOpen={s.authOpen}
          onClose={() => s.setAuthOpen(false)}
          agent={activeAgent}
          onAuthenticated={async () => {
            invalidateAgents(qc);
            const activeId = useStudioStore.getState().activeAgentId;
            try {
              await sessionRpc(activeId, "list", {});
              useStudioStore.getState().setAuthOk(activeId, true);
            } catch {}
          }}
          onLogout={async () => {
            try {
              await logoutAgent(s.activeAgentId);
              invalidateAgents(qc);
            } catch (e: any) {
              alert(`logout 失败: ${e.message}`);
            }
          }}
          authOk={s.authOk[s.activeAgentId] ?? null}
        />
      </Suspense>

      <Suspense fallback={<LazyModalFallback />}>
        <SessionSettingsModal
          isOpen={s.settingsOpen}
          onClose={() => s.setSettingsOpen(false)}
          onCreate={handleCreateSession}
          busy={s.busy}
          defaultCwdHint={effectiveCwd || undefined}
          supportsAdditionalDirs={supportsAdditionalDirs}
          supportsMcpHttp={!!mcpCaps.http}
        />
      </Suspense>

      <Suspense fallback={<LazyModalFallback />}>
        <ProvidersModal isOpen={s.providersOpen} onClose={() => s.setProvidersOpen(false)} agentId={s.activeAgentId} />
      </Suspense>

      <Suspense fallback={<LazyModalFallback />}>
        <CustomAgentModal
          isOpen={customOpen}
          onClose={() => setCustomOpen(false)}
          agents={agents}
          onChanged={() => invalidateAgents(qc)}
        />
      </Suspense>

      <Suspense fallback={<LazyModalFallback />}>
        <GitChangesModal
          isOpen={s.gitChangesOpen}
          onClose={() => s.setGitChangesOpen(false)}
          cwd={effectiveCwd}
          initialFilePath={s.gitDiffFile}
        />
      </Suspense>

      <Suspense fallback={<LazyModalFallback />}>
        <TerminalDrawer
          isOpen={s.terminalOpen}
          onClose={() => s.setTerminalOpen(false)}
          cwd={effectiveCwd}
        />
      </Suspense>

      <Suspense fallback={<LazyModalFallback />}>
        <ModelBrowserModal
          isOpen={s.modelsOpen}
          onClose={() => s.setModelsOpen(false)}
          catalog={s.models}
          modelOption={findConfigOption(s.configOptions, "model")}
          currentModelId={s.models?.currentModelId}
          discovering={s.discovering}
          onRefresh={handleDiscoverModels}
          onApply={handleApplyModel}
        />
      </Suspense>
    </div>
  );
}
