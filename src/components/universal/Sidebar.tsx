import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Folder,
  Boxes,
  Settings,
  Trash2,
  GitFork,
  Bot,
  RefreshCw,
  PlusCircle,
  Cloud,
  MoreHorizontal,
  X,
  FolderOpen,
  Copy,
  Terminal,
  MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { isSameCwd, normalizeCwd, toEnvironmentNativeCwd } from "@/lib/threads";
import type { AgentSummary } from "@/lib/universal-api";
import { getWorkspaceEnv, isPosixEnvironment, type RecentWorkspace } from "@/stores/useStudioStore";
import { SPRING_LAYOUT, SPRING_SWAP } from "@/lib/motion-primitives";
import { MarqueeLabel } from "@/components/primitives/AISidebar";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuShortcut,
} from "@/components/motion/ContextMenu";
import { PullToRefresh } from "@/components/motion/PullToRefresh";

export interface SessionItem {
  sessionId: string;
  title?: string | null;
  cwd?: string;
  updatedAt?: string | null;
}

export interface SidebarProps {
  agents: AgentSummary[];
  activeAgentId: string;
  onSelectAgent: (id: string) => void;
  onConnectAgent: (id: string) => void;
  connectingId: string | null;
  authOk: Record<string, boolean | null>;
  sessions: SessionItem[];
  sessionsLoading: boolean;
  activeSessionId: string | null;
  onRefreshSessions: () => void;
  onNewSession: (targetCwd?: string) => void;
  onOpenSession: (s: SessionItem) => void;
  onForkSession: (s: SessionItem) => void;
  onDeleteSession: (s: SessionItem) => void;
  supportsFork: boolean;
  supportsList: boolean;
  onOpenProviders: () => void;
  supportsProviders: boolean;
  onManageCustom: () => void;
  /** One-click empty-session cleanup (null/false hides it). */
  cleaningEmpty?: boolean;
  onCleanupEmpty?: () => void;
  currentWorkspace?: string | null;
  recentWorkspaces?: RecentWorkspace[];
  onSelectWorkspace?: (path: string, name?: string) => void;
  onOpenSettings?: () => void;
}

function shortCwd(cwd?: string): string {
  if (!cwd) return "";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-1)[0] || "";
}

function compactTimeAgo(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

/** Memoized single agent row */
export interface AgentRowProps {
  agent: AgentSummary;
  active: boolean;
  authOk: boolean | null | undefined;
  connecting: boolean;
  onSelect: (id: string) => void;
  onConnect: (id: string) => void;
}

export const AgentRow = React.memo<AgentRowProps>(
  ({ agent, active, authOk, connecting, onSelect, onConnect }) => {
    const connected = agent.status?.connected;
    return (
      <div
        onClick={() => onSelect(agent.id)}
        title={agent.authHint ? `认证复用：${agent.authHint}` : agent.description}
        className={`rounded-md px-2.5 py-1.5 cursor-pointer border transition-colors ${
          active ? "bg-muted/70 border-border font-medium" : "border-transparent hover:bg-muted/40"
        }`}
      >
        <div className="flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-xs text-foreground truncate flex-1">{agent.title}</span>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              connected ? "bg-success" : "bg-muted-foreground/40"
            }`}
          />
        </div>
      </div>
    );
  }
);
AgentRow.displayName = "AgentRow";

/** Memoized single session row matching Antigravity clean design */
export interface SessionRowProps {
  session: SessionItem;
  active: boolean;
  supportsFork: boolean;
  onOpen: (s: SessionItem) => void;
  onFork: (s: SessionItem) => void;
  onDelete: (s: SessionItem) => void;
}

export const SessionRow = React.memo<SessionRowProps>(
  ({ session, active, supportsFork, onOpen, onFork, onDelete }) => {
    const time = compactTimeAgo(session.updatedAt);
    const [hovered, setHovered] = useState(false);
    const sessionTitle = session.title || session.sessionId;

    return (
      <ContextMenu>
        <ContextMenuTrigger>
          <motion.div
            layout
            transition={SPRING_LAYOUT}
            onClick={() => onOpen(session)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            data-slot="session-row"
            data-session-id={session.sessionId}
            className={`group relative flex items-center justify-between rounded-md px-2 py-1.5 cursor-pointer text-xs transition-colors select-none ${
              active
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            }`}
          >
            {/* 彻底去除原生 title 属性，告别生硬白底遮挡 tooltip */}
            <div className="min-w-0 flex-1 pr-1.5 flex items-center gap-1.5 overflow-hidden">
              <MarqueeLabel active={hovered || active} className="text-xs">
                {session.title || session.sessionId.slice(0, 16)}
              </MarqueeLabel>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Action icons on hover */}
              <span className="hidden group-hover:flex items-center gap-1">
                {supportsFork && (
                  <button
                    type="button"
                    title="Fork 会话"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFork(session);
                    }}
                    className="p-0.5 rounded hover:text-foreground transition-colors"
                  >
                    <GitFork className="w-3 h-3" />
                  </button>
                )}
                <button
                  type="button"
                  title="删除会话"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session);
                  }}
                  className="p-0.5 rounded hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>

              {/* Timestamp or Active blue indicator */}
              {active ? (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-signal shrink-0 group-hover:hidden"
                  title="活动会话"
                />
              ) : time ? (
                <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums shrink-0 group-hover:hidden">
                  {time}
                </span>
              ) : null}
            </div>
          </motion.div>
        </ContextMenuTrigger>

        <ContextMenuContent ariaLabel={`会话 ${sessionTitle} 操作菜单`}>
          <ContextMenuLabel>会话操作</ContextMenuLabel>
          <ContextMenuItem onSelect={() => onOpen(session)}>
            <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>进入会话</span>
          </ContextMenuItem>
          {supportsFork && (
            <ContextMenuItem onSelect={() => onFork(session)}>
              <GitFork className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span>分叉新会话 (Fork)</span>
              <ContextMenuShortcut>Fork</ContextMenuShortcut>
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(sessionTitle);
            }}
          >
            <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span>复制会话标题</span>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(session.sessionId);
            }}
          >
            <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span>复制会话 ID</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            tone="destructive"
            onSelect={() => onDelete(session)}
          >
            <Trash2 className="w-3.5 h-3.5 text-destructive shrink-0" />
            <span>删除此会话</span>
            <ContextMenuShortcut>Del</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }
);
SessionRow.displayName = "SessionRow";

export interface ProjectSessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  isCloud?: boolean;
  sessions: SessionItem[];
  activeSessionId: string | null;
  supportsFork: boolean;
  onOpenSession: (s: SessionItem) => void;
  onForkSession: (s: SessionItem) => void;
  onDeleteSession: (s: SessionItem) => void;
}

export const ProjectSessionsModal: React.FC<ProjectSessionsModalProps> = ({
  isOpen,
  onClose,
  projectName,
  isCloud,
  sessions,
  activeSessionId,
  supportsFork,
  onOpenSession,
  onForkSession,
  onDeleteSession,
}) => {
  const [filter, setFilter] = useState("");

  if (!isOpen) return null;

  const filtered = filter.trim()
    ? sessions.filter((s) => (s.title || s.sessionId).toLowerCase().includes(filter.trim().toLowerCase()))
    : sessions;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[80vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {isCloud ? (
              <Cloud className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-primary shrink-0" />
            )}
            <h3 className="font-semibold text-sm text-foreground truncate">{projectName}</h3>
            <span className="text-[11px] font-mono text-muted-foreground/80 px-1.5 py-0.5 rounded bg-muted">
              {sessions.length} 个会话
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter input */}
        <div className="px-4 py-2.5 border-b border-border/40 shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索此项目下的所有会话..."
              autoFocus
              className="w-full bg-muted/40 border border-border/60 rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60"
            />
          </div>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">未找到匹配会话</div>
          ) : (
            filtered.map((s) => (
              <SessionRow
                key={s.sessionId}
                session={s}
                active={s.sessionId === activeSessionId}
                supportsFork={supportsFork}
                onOpen={(sess) => {
                  onOpenSession(sess);
                  onClose();
                }}
                onFork={onForkSession}
                onDelete={onDeleteSession}
              />
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-4 py-2 border-t border-border/40 text-[11px] text-muted-foreground flex items-center justify-between shrink-0 bg-muted/20">
          <span>点击切换会话 · 支持实时搜索</span>
          <span className="font-mono text-[10px]">点击外部或 ✕ 关闭</span>
        </div>
      </div>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = (p) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [modalProject, setModalProject] = useState<{
    name: string;
    items: SessionItem[];
    isCloud?: boolean;
  } | null>(null);

  const MAX_VISIBLE_SESSIONS = 5;

  // Group sessions by directory/project
  const projectGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? p.sessions.filter((s) => (s.title || s.sessionId).toLowerCase().includes(query))
      : p.sessions;

    const isPosix = isPosixEnvironment();

    // 通用路径提纯与规范化（零硬编码，适用于 WSL、SSH 远程、本地 Windows）
    const sanitizePath = (p?: string | null): string | null => {
      if (!p) return null;
      return toEnvironmentNativeCwd(p, isPosix);
    };

    // 自适应环境判定：
    // 检查是否有任何原生 POSIX 路径（非 Windows 盘符开头，包含 /）
    const hasAnyPosixSess = p.sessions.some((s) => {
      const c = s.cwd;
      return Boolean(c && (c.startsWith("/") || /^(?:\\\\|\/\/)wsl(?:\$|\.localhost)/i.test(c)) && !/^[a-zA-Z]:/.test(c));
    });

    const isPathMatchingEnv = (pathStr?: string | null): boolean => {
      const clean = sanitizePath(pathStr);
      if (!clean) return false;
      const isWin = /^[a-zA-Z]:[\\\/]/i.test(clean) || /^\/mnt\/[a-zA-Z](\/|$)/i.test(clean);
      if (isPosix && hasAnyPosixSess) {
        return !isWin;
      } else if (!isPosix) {
        // Windows 环境下只匹配属于 Windows 的工作区
        return isWin;
      }
      return true;
    };

    const map = new Map<
      string,
      {
        id: string;
        name: string;
        path?: string;
        items: SessionItem[];
        isCurrent: boolean;
        isCloud?: boolean;
      }
    >();

    // 1. Seed recent workspaces (仅加载属于当前环境的工程)
    if (p.recentWorkspaces && p.recentWorkspaces.length > 0) {
      for (const rawW of p.recentWorkspaces) {
        const wPath = sanitizePath(rawW.path) || rawW.path;
        if (!isPathMatchingEnv(wPath)) continue;
        const key = normalizeCwd(wPath) || wPath;
        const name = rawW.name || shortCwd(wPath) || wPath;
        const isCurrent = Boolean(p.currentWorkspace && isSameCwd(p.currentWorkspace, wPath));
        map.set(key, {
          id: key,
          name,
          path: wPath,
          items: [],
          isCurrent,
          isCloud: name.toLowerCase().includes("cli") || name.toLowerCase().includes("cloud"),
        });
      }
    }

    // 2. Seed current workspace if not present in recents
    if (p.currentWorkspace && isPathMatchingEnv(p.currentWorkspace)) {
      const curPath = sanitizePath(p.currentWorkspace) || p.currentWorkspace;
      const curKey = normalizeCwd(curPath) || curPath;
      if (!map.has(curKey)) {
        const name = shortCwd(curPath) || curPath;
        map.set(curKey, {
          id: curKey,
          name,
          path: curPath,
          items: [],
          isCurrent: true,
          isCloud: name.toLowerCase().includes("cli") || name.toLowerCase().includes("cloud"),
        });
      }
    }

    // 3. Distribute sessions to matching project
    for (const rawSess of filtered) {
      const cleanCwd = sanitizePath(rawSess.cwd) || rawSess.cwd;
      const sess = cleanCwd !== rawSess.cwd ? { ...rawSess, cwd: cleanCwd } : rawSess;
      const sessCwd = sess.cwd ? (normalizeCwd(sess.cwd) || sess.cwd) : null;

      // 若历史会话关联的目录与当前环境不符，在当前视图中过滤
      if (sessCwd && !isPathMatchingEnv(sessCwd)) {
        continue;
      }

      let matchedKey: string | null = null;

      if (sessCwd) {
        for (const [key, grp] of map.entries()) {
          if (grp.path && isSameCwd(grp.path, sess.cwd)) {
            matchedKey = key;
            break;
          }
        }
        if (!matchedKey) {
          const rawPath = sess.cwd || sessCwd;
          const name = shortCwd(rawPath) || rawPath;
          const isCurrent = Boolean(p.currentWorkspace && isSameCwd(p.currentWorkspace, rawPath));
          matchedKey = sessCwd;
          map.set(matchedKey, {
            id: matchedKey,
            name,
            path: rawPath,
            items: [],
            isCurrent,
            isCloud: name.toLowerCase().includes("cli") || name.toLowerCase().includes("cloud"),
          });
        }
      } else {
        if (p.currentWorkspace && isPathMatchingEnv(p.currentWorkspace)) {
          matchedKey = normalizeCwd(p.currentWorkspace) || p.currentWorkspace;
        } else {
          matchedKey = "general";
          if (!map.has(matchedKey)) {
            map.set(matchedKey, {
              id: "general",
              name: "General",
              items: [],
              isCurrent: false,
            });
          }
        }
      }

      if (matchedKey) {
        const grp = map.get(matchedKey);
        if (grp) grp.items.push(sess);
      }
    }

    // 4. 确保当前正在活跃会话（即使尚未在 sessions 列表里）自动并入当前激活的项目组中
    if (p.activeSessionId) {
      const allSessionIds = new Set<string>();
      for (const grp of map.values()) {
        for (const item of grp.items) allSessionIds.add(item.sessionId);
      }
      if (!allSessionIds.has(p.activeSessionId)) {
        let grp = p.currentWorkspace
          ? map.get(normalizeCwd(sanitizePath(p.currentWorkspace) || p.currentWorkspace) || p.currentWorkspace)
          : undefined;
        if (!grp) {
          for (const g of map.values()) {
            if (g.isCurrent) {
              grp = g;
              break;
            }
          }
        }
        if (!grp && map.size > 0) {
          grp = map.values().next().value;
        }
        if (grp) {
          grp.items.unshift({
            sessionId: p.activeSessionId,
            title: `当前会话 (${p.activeSessionId.slice(0, 8)})`,
            cwd: grp.path || p.currentWorkspace || undefined,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    // Sort: 当前激活工作区置顶，其余按名称字母排序
    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return list;
  }, [p.sessions, searchQuery, p.recentWorkspaces, p.currentWorkspace]);

  const toggleProject = (name: string) => {
    setCollapsedProjects((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-sidebar flex flex-col text-xs overflow-hidden select-none z-10 transition-colors">
      {/* 1. 顶部：新会话为主操作，搜索 / 清理 / 刷新为次要图标 */}
      <div className="h-12 px-2 flex items-center gap-1 border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => p.onNewSession()}
          className="flex-1 h-7 px-2 rounded-md flex items-center gap-2 text-[13px] font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-muted-foreground" />
          <span>新会话</span>
        </button>
        <button
          type="button"
          onClick={() => setShowSearch(!showSearch)}
          title="搜索会话"
          aria-label="搜索会话"
          aria-pressed={showSearch}
          className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${showSearch ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
        >
          <Search className="w-3.5 h-3.5" />
        </button>
        {p.onCleanupEmpty && (
          <button
            type="button"
            onClick={p.onCleanupEmpty}
            disabled={p.cleaningEmpty}
            title="清理空会话"
            aria-label="清理空会话"
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
          >
            <Trash2 className={`w-3.5 h-3.5 ${p.cleaningEmpty ? "animate-pulse" : ""}`} />
          </button>
        )}
        <button
          type="button"
          onClick={p.onRefreshSessions}
          title="刷新会话列表"
          aria-label="刷新会话列表"
          className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${p.sessionsLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Optional Search Input */}
      {showSearch && (
        <div className="px-2 pt-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="按标题或 ID 搜索"
            autoFocus
            className="w-full h-7 bg-background border border-input rounded-md px-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring"
          />
        </div>
      )}

      {/* 2. 只保留真正可用的入口（原 Conversation History 实为新建会话、Automations 无功能，已移除） */}
      <div className="px-2 pt-2 shrink-0">
        <button
          type="button"
          onClick={p.onManageCustom}
          className="w-full h-7 flex items-center gap-2 px-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left"
        >
          <Boxes className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate flex-1">自定义智能体</span>
        </button>
      </div>

      {/* 4. Projects Tree Header */}
      <div className="mt-3 px-4 pb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground shrink-0 select-none">
        <span>项目</span>
        <div className="flex items-center gap-1 text-muted-foreground">
          <button
            type="button"
            onClick={() => {
              useWorkbenchStore.getState().openWorkspacePicker();
            }}
            title="打开本地项目文件夹 (Ctrl+O)"
            aria-label="打开本地项目文件夹"
            className="h-5 w-5 rounded flex items-center justify-center hover:text-foreground hover:bg-accent cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => p.onNewSession()}
            title="新建会话"
            aria-label="新建会话"
            className="h-5 w-5 rounded flex items-center justify-center hover:text-foreground hover:bg-accent cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 5. Scrollable Project Groups & Conversations Tree with BeUI PullToRefresh */}
      <PullToRefresh
        onRefresh={async () => {
          p.onRefreshSessions();
        }}
        refreshing={p.sessionsLoading}
        className="flex-1 px-2 space-y-1.5 py-1"
      >
        {projectGroups.map((grp) => {
          const isCollapsed = Boolean(collapsedProjects[grp.id || grp.name]);
          return (
            <div key={grp.id || grp.name} className="space-y-0.5">
              {/* Project folder row */}
              <div
                onClick={() => {
                  if (grp.path && p.onSelectWorkspace && p.currentWorkspace !== grp.path) {
                    p.onSelectWorkspace(grp.path, grp.name);
                  } else {
                    toggleProject(grp.id || grp.name);
                  }
                }}
                className={`group flex items-center gap-1.5 px-2 h-7 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                  grp.isCurrent
                    ? "bg-accent/80 text-foreground font-semibold border border-border/50"
                    : "text-foreground/80 hover:bg-accent/50 hover:text-foreground border border-transparent"
                }`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleProject(grp.id || grp.name);
                  }}
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <motion.span
                    className="grid size-3 place-items-center"
                    animate={{ rotate: isCollapsed ? 0 : 90 }}
                    transition={SPRING_SWAP}
                  >
                    <ChevronRight className="w-3 h-3 shrink-0" />
                  </motion.span>
                </button>
                {grp.isCloud ? (
                  <Cloud className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                ) : isCollapsed ? (
                  <Folder className="w-3.5 h-3.5 text-primary/80 shrink-0" />
                ) : (
                  <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                )}
                <span className="truncate flex-1 font-medium" title={grp.path || grp.name}>
                  {grp.name}
                </span>

                {grp.isCurrent && (
                  <span className="text-[9.5px] px-1 py-0.2 rounded bg-primary/15 text-primary font-mono font-medium shrink-0">
                    当前
                  </span>
                )}

                {/* 悬停快捷入口：在该工作区新建会话 */}
                <button
                  type="button"
                  title={`在 ${grp.name} 中新建会话`}
                  aria-label={`在 ${grp.name} 中新建会话`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (grp.path && p.onSelectWorkspace) {
                      p.onSelectWorkspace(grp.path, grp.name);
                    }
                    p.onNewSession(grp.path);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-all shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Child sessions */}
              {!isCollapsed && (
                <div className="pl-2 space-y-px border-l border-border/70 ml-3.5 my-0.5">
                  {grp.items.length === 0 ? (
                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground flex items-center justify-between">
                      <span>暂无会话</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (grp.path && p.onSelectWorkspace) {
                            p.onSelectWorkspace(grp.path, grp.name);
                          }
                          p.onNewSession(grp.path);
                        }}
                        className="text-[10px] text-primary hover:underline cursor-pointer"
                      >
                        + 新建
                      </button>
                    </div>
                  ) : (() => {
                    const isExpanded = Boolean(expandedProjects[grp.id || grp.name]);
                    const total = grp.items.length;
                    const needsTruncation = total > MAX_VISIBLE_SESSIONS && !isExpanded;

                    let visibleItems = grp.items;
                    if (needsTruncation) {
                      const activeIdx = grp.items.findIndex((s) => s.sessionId === p.activeSessionId);
                      if (activeIdx >= MAX_VISIBLE_SESSIONS) {
                        visibleItems = [
                          ...grp.items.slice(0, MAX_VISIBLE_SESSIONS - 1),
                          grp.items[activeIdx],
                        ];
                      } else {
                        visibleItems = grp.items.slice(0, MAX_VISIBLE_SESSIONS);
                      }
                    }

                    return (
                      <>
                        {visibleItems.map((s) => (
                          <SessionRow
                            key={s.sessionId}
                            session={s}
                            active={s.sessionId === p.activeSessionId}
                            supportsFork={p.supportsFork}
                            onOpen={(sess) => {
                              if (sess.cwd && p.onSelectWorkspace && p.currentWorkspace !== sess.cwd) {
                                p.onSelectWorkspace(sess.cwd, grp.name);
                              }
                              p.onOpenSession(sess);
                            }}
                            onFork={p.onForkSession}
                            onDelete={p.onDeleteSession}
                          />
                        ))}

                        {total > MAX_VISIBLE_SESSIONS && (
                          <div className="pt-0.5 flex items-center justify-between text-[11px] select-none">
                            <button
                              type="button"
                              onClick={() => setModalProject(grp)}
                              title={`查看全部 ${total} 个会话`}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                              <span>{total - visibleItems.length > 0 ? `更多 ${total - visibleItems.length} 个...` : "查看全部..."}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedProjects((prev) => ({
                                  ...prev,
                                  [grp.id || grp.name]: !prev[grp.id || grp.name],
                                }))
                              }
                              className="text-[10px] text-muted-foreground/60 hover:text-foreground px-1 py-0.5 rounded transition-colors"
                            >
                              {isExpanded ? "收起" : "展开"}
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}

        {/* Fallback if no projects */}
        {projectGroups.length === 0 && (
          <div className="px-3 py-4 text-center text-muted-foreground text-xs">
            暂无会话项目
          </div>
        )}
      </PullToRefresh>

      {/* 6. Bottom Sticky Settings Bar */}
      <div className="p-2 border-t border-border shrink-0">
        <button
          type="button"
          onClick={() => (p.onOpenSettings ? p.onOpenSettings() : p.onNewSession())}
          title="设置新会话的工作目录与 MCP 服务"
          className="w-full h-7 flex items-center gap-2 px-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>会话设置</span>
        </button>
      </div>

      {/* 7. Modal for viewing all sessions in a project */}
      {modalProject && (
        <ProjectSessionsModal
          isOpen={Boolean(modalProject)}
          onClose={() => setModalProject(null)}
          projectName={modalProject.name}
          isCloud={modalProject.isCloud}
          sessions={modalProject.items}
          activeSessionId={p.activeSessionId}
          supportsFork={p.supportsFork}
          onOpenSession={p.onOpenSession}
          onForkSession={p.onForkSession}
          onDeleteSession={p.onDeleteSession}
        />
      )}
    </aside>
  );
};
