import React from "react";
import { Bot, Plug, PlugZap, RefreshCw, ShieldCheck, LogOut } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import type { AgentSummary } from "../../lib/universal-api";

export interface AgentBarProps {
  agents: AgentSummary[];
  activeAgentId: string;
  onSelect: (id: string) => void;
  onConnect: () => void;
  connecting: boolean;
  onOpenAuth: () => void;
  onLogout: () => void;
  /** Local-auth probe result: true = session/list ok without authenticate. */
  authOk?: boolean | null;
}

export const AgentBar: React.FC<AgentBarProps> = ({
  agents,
  activeAgentId,
  onSelect,
  onConnect,
  connecting,
  onOpenAuth,
  onLogout,
  authOk,
}) => {
  const active = agents.find((a) => a.id === activeAgentId);
  const connected = Boolean(active?.status?.connected);
  const caps = active?.status?.agentCapabilities as any;
  const proto = active?.status?.protocolVersion;

  return (
    <div className="flex items-center gap-2.5 px-4 py-2 border-b border-border/70 bg-background/70 backdrop-blur text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Bot className="w-3.5 h-3.5 text-primary" />
        <span className="font-semibold">Agent</span>
      </div>
      <select
        value={activeAgentId}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-card border border-border rounded-lg px-2 py-1.5 text-foreground outline-none text-xs max-w-[220px]"
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id} className="bg-card">
            {a.title} ({a.id}) {a.status?.connected ? "●" : ""}
          </option>
        ))}
      </select>
      <span className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-muted-foreground"}`} title={connected ? "connected" : "disconnected"} />
      {active?.status?.agentInfo && (
        <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[260px]">
          {(active.status.agentInfo as any).title || (active.status.agentInfo as any).name} v{(active.status.agentInfo as any).version} · ACP v{proto ?? "?"}
        </span>
      )}
      {caps?.sessionCapabilities && (
        <Badge variant="outline" className="text-[10px] h-5 font-mono">
          {Object.keys(caps.sessionCapabilities).join("/") || "sessions"}
        </Badge>
      )}
      <div className="flex-1" />
      {active?.status?.lastError && !connected && (
        <span className="text-[11px] text-destructive truncate max-w-[320px]" title={active.status.lastError}>
          {active.status.lastError.slice(0, 120)}
        </span>
      )}
      {!connected ? (
        <Button size="sm" variant="default" onClick={onConnect} disabled={connecting} className="h-7 text-xs gap-1.5">
          {connecting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plug className="w-3 h-3" />}
          {connecting ? "连接中..." : "连接"}
        </Button>
      ) : (
        <Badge variant="success" className="h-6 text-[10px] gap-1">
          <PlugZap className="w-3 h-3" />
          已连接{active?.status?.pid ? ` · pid ${active.status.pid}` : ""}
        </Badge>
      )}
      {connected && authOk === true && (
        <Badge variant="success" className="h-6 text-[10px] gap-1" title="本地登录态复用成功（session/list 无需 authenticate 即可通过）">
          <ShieldCheck className="w-3 h-3" />
          本地已登录
        </Badge>
      )}
      {connected && authOk === false && (
        <Badge variant="warning" className="h-6 text-[10px]" title="需要先完成 authenticate 才能创建会话">
          需认证
        </Badge>
      )}
      <Button size="sm" variant="outline" onClick={onOpenAuth} className="h-7 text-xs gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-success" />
        认证
      </Button>
      <button onClick={onLogout} title="logout" className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted">
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
