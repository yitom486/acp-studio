import React from "react";
import { Bot, PlusCircle, RefreshCw, GitFork, Trash2, XCircle, Cpu, Plug } from "lucide-react";
import { Badge } from "../ui/badge";
import type { AgentSummary } from "../../lib/universal-api";

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
  onNewSession: () => void;
  onOpenSession: (s: SessionItem) => void;
  onForkSession: (s: SessionItem) => void;
  onDeleteSession: (s: SessionItem) => void;
  supportsFork: boolean;
  supportsList: boolean;
  onOpenProviders: () => void;
  supportsProviders: boolean;
  onManageCustom: () => void;
}

function shortCwd(cwd?: string): string {
  if (!cwd) return "";
  const parts = cwd.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}

export const Sidebar: React.FC<SidebarProps> = (p) => {
  return (
    <aside className="w-64 shrink-0 border-r border-border/80 bg-background/90 flex flex-col text-xs overflow-hidden select-none">
      {/* Agents */}
      <div className="px-3.5 pt-4 pb-2.5 flex items-center justify-between app-drag">
        <span className="font-bold text-muted-foreground tracking-wide">AGENTS</span>
        <button onClick={p.onManageCustom} title="添加 / 管理自定义 agent" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground app-no-drag">
          <PlusCircle className="w-3.5 h-3.5" />自定
        </button>
      </div>
      <div className="px-2 space-y-1 overflow-y-auto max-h-[38%]">
        {p.agents.map((a) => {
          const active = a.id === p.activeAgentId;
          const connected = a.status?.connected;
          return (
            <div
              key={a.id}
              onClick={() => p.onSelectAgent(a.id)}
              title={a.authHint ? `认证复用：${a.authHint}` : a.description}
              className={`rounded-xl px-2.5 py-2 cursor-pointer border transition-colors ${
                active ? "bg-muted/50 border-primary/40" : "border-transparent hover:bg-card"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="font-semibold text-foreground truncate flex-1">{a.title}</span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-success" : "bg-muted-foreground"}`} />
              </div>
              <div className="flex items-center gap-1.5 mt-1 pl-5">
                <span className="font-mono text-[10px] text-muted-foreground truncate flex-1">{a.id}</span>
                {p.authOk[a.id] === true && <Badge variant="success" className="h-4 text-[9px] px-1">已登录</Badge>}
                {p.authOk[a.id] === false && <Badge variant="warning" className="h-4 text-[9px] px-1">需认证</Badge>}
                {!connected && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onConnectAgent(a.id);
                    }}
                    disabled={p.connectingId === a.id}
                    className="flex items-center gap-1 text-[10px] text-primary hover:text-foreground disabled:opacity-50"
                  >
                    {p.connectingId === a.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plug className="w-3 h-3" />}
                    连接
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {p.agents.length === 0 && <div className="text-muted-foreground px-2 py-1">加载中…</div>}
      </div>

      {/* Sessions */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between border-t border-border/60 mt-1">
        <span className="font-bold text-muted-foreground tracking-wide">SESSIONS</span>
        <div className="flex items-center gap-1">
          <button onClick={p.onRefreshSessions} title="刷新会话列表" className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted">
            <RefreshCw className={`w-3.5 h-3.5 ${p.sessionsLoading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={p.onNewSession} title="新会话" className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted">
            <PlusCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="px-2 space-y-1 overflow-y-auto flex-1">
        {!p.supportsList && (
          <div className="text-[11px] text-muted-foreground px-2 py-1">该 Agent 不支持 session/list。</div>
        )}
        {p.sessions.map((s) => {
          const active = s.sessionId === p.activeSessionId;
          return (
            <div
              key={s.sessionId}
              onClick={() => p.onOpenSession(s)}
              className={`rounded-xl px-2.5 py-2 cursor-pointer border group transition-colors ${
                active ? "bg-muted/50 border-primary/40" : "border-transparent hover:bg-card"
              }`}
            >
              <div className="text-foreground truncate font-medium" title={s.sessionId}>
                {s.title || s.sessionId.slice(0, 12) + "…"}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-mono text-muted-foreground">
                <span className="truncate flex-1">{shortCwd(s.cwd)}</span>
                <span className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {p.supportsFork && (
                    <span
                      title="Fork 会话"
                      onClick={(e) => {
                        e.stopPropagation();
                        p.onForkSession(s);
                      }}
                      className="hover:text-primary"
                    >
                      <GitFork className="w-3 h-3" />
                    </span>
                  )}
                  <span
                    title="删除会话"
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onDeleteSession(s);
                    }}
                    className="hover:text-destructive"
                  >
                    <Trash2 className="w-3 h-3" />
                  </span>
                </span>
              </div>
            </div>
          );
        })}
        {p.supportsList && p.sessions.length === 0 && !p.sessionsLoading && (
          <div className="text-[11px] text-muted-foreground px-2 py-1">暂无会话，点击 + 新建。</div>
        )}
      </div>

      {/* Footer: providers */}
      <div className="p-2 border-t border-border/60">
        {p.supportsProviders ? (
          <button
            onClick={p.onOpenProviders}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-muted-foreground hover:bg-card"
          >
            <Cpu className="w-3.5 h-3.5 text-primary" />
            Providers（模型通道）
          </button>
        ) : (
          <div className="px-2.5 py-1 text-[10px] font-mono text-muted-foreground flex items-center gap-1">
            <XCircle className="w-3 h-3" /> 无 providers 能力
          </div>
        )}
      </div>
    </aside>
  );
};
