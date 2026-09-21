import React, { useState, useRef, useEffect } from "react";
import {
  Bot,
  Plug,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  GitFork,
  Cpu,
  FileDiff,
  Plus,
  MoreHorizontal,
  XCircle,
  Trash2,
  LogOut,
  Gauge,
  Info,
  ChevronDown,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import type { AgentSummary } from "../../lib/universal-api";
import { WorkspaceDropdown } from "./WorkspaceDropdown";
import type { RecentWorkspace } from "../../stores/useStudioStore";

export interface StudioHeaderProps {
  agents: AgentSummary[];
  activeAgentId: string;
  onSelectAgent: (id: string) => void;
  onConnect: () => void;
  connecting: boolean;
  onOpenAuth: () => void;
  onLogout: () => void;
  authOk?: boolean | null;

  sessionId: string | null;
  sessionTitle?: string;
  usage?: { used: number; size: number; cost?: { amount: number; currency: string } } | null;

  currentWorkspace: string | null;
  recentWorkspaces: RecentWorkspace[];
  onSelectWorkspace: (path: string, name?: string) => void;

  terminalOpen: boolean;
  onToggleTerminal: () => void;

  hasChangesCwd: boolean;
  supportsFork: boolean;
  supportsProviders: boolean;
  busy: boolean;
  isStreaming: boolean;

  onNewSession: () => void;
  onForkSession: () => void;
  onOpenProviders: () => void;
  onOpenChanges: () => void;
  onCloseSession: () => void;
  onDeleteSession: () => void;
  onClearMessages: () => void;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  agents,
  activeAgentId,
  onSelectAgent,
  onConnect,
  connecting,
  onOpenAuth,
  onLogout,
  authOk,
  sessionId,
  sessionTitle,
  usage,
  currentWorkspace,
  recentWorkspaces,
  onSelectWorkspace,
  terminalOpen,
  onToggleTerminal,
  hasChangesCwd,
  supportsFork,
  supportsProviders,
  busy,
  isStreaming,
  onNewSession,
  onForkSession,
  onOpenProviders,
  onOpenChanges,
  onCloseSession,
  onDeleteSession,
  onClearMessages,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const active = agents.find((a) => a.id === activeAgentId);
  const connected = Boolean(active?.status?.connected);
  const caps = active?.status?.agentCapabilities as any;
  const proto = active?.status?.protocolVersion;
  const agentInfo = active?.status?.agentInfo as any;
  const pid = active?.status?.pid;

  // Close more menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  return (
    <header className="h-16 pt-3 pb-2 border-b border-border/80 bg-background/85 backdrop-blur-md px-5 flex items-center justify-between gap-3 shrink-0 z-20 select-none app-drag">
      {/* LEFT: Brand + Agent Selector + Connection Status */}
      <div className="flex items-center gap-2.5 min-w-0 app-no-drag">
        <div className="flex items-center gap-1.5 shrink-0 text-foreground font-semibold text-xs tracking-tight mr-1 hidden sm:flex">
          <Sparkles className="w-4 h-4 text-primary" />
          <span>ACP Studio</span>
        </div>

        {/* Agent Dropdown */}
        <div className="relative flex items-center">
          <select
            value={activeAgentId}
            onChange={(e) => onSelectAgent(e.target.value)}
            className="bg-card/80 hover:bg-card border border-border rounded-lg pl-2.5 pr-7 py-1 text-xs text-foreground outline-none font-medium cursor-pointer transition-colors max-w-[180px] sm:max-w-[210px] appearance-none"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id} className="bg-card text-foreground">
                {a.title} ({a.id}) {a.status?.connected ? "●" : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2 pointer-events-none" />
        </div>

        {/* Connection status / Connect button */}
        {!connected ? (
          <Button
            size="sm"
            variant="default"
            onClick={onConnect}
            disabled={connecting}
            className="h-7 px-2.5 text-xs gap-1 font-medium shadow-sm"
          >
            {connecting ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Plug className="w-3 h-3" />
            )}
            <span>{connecting ? "连接中" : "连接"}</span>
          </Button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
            </span>
            <Badge variant="outline" className="h-6 text-[10px] font-mono px-2 gap-1 text-muted-foreground hidden md:inline-flex">
              <PlugZap className="w-3 h-3 text-success" />
              <span>{pid ? `pid ${pid}` : "已连接"}</span>
            </Badge>
          </div>
        )}

        {/* Capability Info Tooltip (replaces ugly raw capability strings) */}
        {connected && (
          <div className="relative group hidden lg:flex items-center">
            <button
              type="button"
              className="text-muted-foreground/60 hover:text-foreground p-1 transition-colors rounded-md hover:bg-muted/80"
              title="智能体协议与能力详情"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
            <div className="absolute left-0 top-full mt-1.5 hidden group-hover:block w-72 p-3 rounded-xl border border-border bg-popover/95 shadow-xl text-[11px] text-muted-foreground space-y-1.5 z-50 backdrop-blur-md pointer-events-none">
              <div className="font-semibold text-foreground flex items-center justify-between">
                <span>{agentInfo?.title || active?.title}</span>
                <span className="font-mono text-[10px] text-primary">ACP v{proto ?? "1"}</span>
              </div>
              {agentInfo?.version && (
                <div className="text-[10px]">版本: {agentInfo.version}</div>
              )}
              {caps?.sessionCapabilities && (
                <div className="pt-1 border-t border-border/60">
                  <div className="text-[10px] text-foreground font-medium mb-1">支持的会话能力:</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(caps.sessionCapabilities).map((k) => (
                      <span key={k} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Auth status */}
        {connected && authOk === true && (
          <Badge variant="success" className="h-6 text-[10px] gap-1 hidden sm:inline-flex" title="本地登录凭据已复用">
            <ShieldCheck className="w-3 h-3" />
            <span>已认证</span>
          </Badge>
        )}
        {connected && authOk === false && (
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenAuth}
            className="h-6 text-[10px] px-2 gap-1 border-warning/40 text-warning hover:bg-warning/10"
            title="需要完成登录认证"
          >
            <ShieldAlert className="w-3 h-3" />
            <span>需认证</span>
          </Button>
        )}
        {/* Workspace Dropdown */}
        <WorkspaceDropdown
          currentWorkspace={currentWorkspace}
          recentWorkspaces={recentWorkspaces}
          onSelectWorkspace={onSelectWorkspace}
        />
      </div>

      {/* CENTER: Current Session Title & Token Usage */}
      <div className="flex items-center gap-2 min-w-0 flex-1 justify-center max-w-lg app-no-drag">
        {sessionId ? (
          <div className="flex items-center gap-2 min-w-0 bg-muted/40 border border-border/60 rounded-full px-3 py-1">
            <span className="text-xs font-semibold text-foreground truncate max-w-[140px] sm:max-w-[220px]">
              {sessionTitle || "当前会话"}
            </span>
            <Badge variant="secondary" className="font-mono text-[10px] h-4 px-1.5 hidden md:inline-flex">
              {sessionId.slice(0, 8)}…
            </Badge>
            {usage && (
              <span className="items-center gap-1 font-mono text-[10px] text-muted-foreground hidden lg:inline-flex pl-1 border-l border-border/60">
                <Gauge className="w-3 h-3 text-primary" />
                {usage.used.toLocaleString()}/{usage.size.toLocaleString()}
                {usage.cost && <span className="text-success">${usage.cost.amount}</span>}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/70 hidden sm:inline">无活动会话，发送消息自动新建</span>
        )}
      </div>

      {/* RIGHT: Actions (Changes, Terminal, Providers, + New Session, More Menu) */}
      <div className="flex items-center gap-1.5 shrink-0 app-no-drag">
        {/* Code Changes / Diff */}
        <Button
          size="sm"
          variant="outline"
          onClick={onOpenChanges}
          disabled={busy || !hasChangesCwd}
          title={hasChangesCwd ? "查看本地代码变更 (Ctrl+Shift+D)" : "当前目录无代码变更"}
          className={`h-7 px-2.5 text-xs gap-1.5 transition-colors ${
            hasChangesCwd ? "border-primary/40 text-primary hover:bg-primary/10" : "text-muted-foreground opacity-60"
          }`}
        >
          <FileDiff className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">变更</span>
        </Button>

        {/* Integrated Terminal Drawer */}
        <Button
          size="sm"
          variant={terminalOpen ? "default" : "outline"}
          onClick={onToggleTerminal}
          title="集成终端 (Ctrl+`)"
          className={`h-7 px-2.5 text-xs gap-1.5 transition-colors ${
            terminalOpen ? "shadow-sm font-semibold" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">终端</span>
        </Button>

        {/* Providers */}
        {supportsProviders && (
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenProviders}
            disabled={busy}
            title="Providers（模型通道与网关配置）"
            className="h-7 px-2.5 text-xs gap-1.5 hidden sm:inline-flex"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>通道</span>
          </Button>
        )}

        {/* Primary New Session Button */}
        <Button
          size="sm"
          variant="default"
          onClick={onNewSession}
          disabled={isStreaming || busy}
          className="h-7 px-3 text-xs gap-1.5 font-medium shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新会话</span>
        </Button>

        {/* More Actions Menu (...) */}
        <div className="relative" ref={menuRef}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMenuOpen(!menuOpen)}
            className="h-7 w-7 p-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
            title="更多会话与智能体操作"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </Button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-44 p-1 rounded-xl border border-border bg-popover/95 shadow-xl text-xs z-50 backdrop-blur-md animate-in fade-in-50 zoom-in-95 duration-100">
              {supportsFork && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onForkSession();
                  }}
                  disabled={busy || !sessionId}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-40 transition-colors"
                >
                  <GitFork className="w-3.5 h-3.5" />
                  <span>Fork 会话</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onClearMessages();
                }}
                disabled={isStreaming}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-40 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>清空消息记录</span>
              </button>

              {sessionId && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onCloseSession();
                  }}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-40 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>关闭会话</span>
                </button>
              )}

              {sessionId && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDeleteSession();
                  }}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>删除会话</span>
                </button>
              )}

              <div className="my-1 border-t border-border/60" />

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>退出 Agent 登录</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
