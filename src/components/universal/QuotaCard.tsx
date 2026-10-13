import React from "react";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  RefreshCw,
  Clock,
  User,
  CreditCard,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface QuotaLimitWindow {
  label: string;
  percentLeft: number;
  usedPercent?: number;
  used?: number | string;
  total?: number | string;
  windowDurationMins?: number;
  resetsAt?: string | number;
}

export interface QuotaAccountInfo {
  name?: string;
  email?: string;
  plan?: string;
  type?: string;
}

export interface QuotaCredits {
  balance?: number | string;
  currency?: string;
  unlimited?: boolean;
}

export interface UniversalQuotaState {
  runtimeId?: string;
  provider?: string;
  account?: QuotaAccountInfo;
  primaryWindow?: QuotaLimitWindow;
  secondaryWindow?: QuotaLimitWindow;
  credits?: QuotaCredits;
  extraWindows?: QuotaLimitWindow[];
  status?: "ok" | "warning" | "exhausted" | "banned" | "unauthorized" | "unknown";
  message?: string;
  rawText?: string;
  updatedAt?: number;
}

/**
 * 迷你环形进度指示器（14x14 SVG）用于在 AgentStatusChip 紧凑栏内直观展示 5h 剩余额度
 */
export const QuotaRing: React.FC<{
  percentLeft: number;
  size?: number;
  className?: string;
}> = ({ percentLeft, size = 14, className }) => {
  const clamped = Math.max(0, Math.min(100, Math.round(percentLeft)));
  const strokeWidth = 2.2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  const colorClass =
    clamped > 40
      ? "text-emerald-500"
      : clamped > 15
      ? "text-amber-500"
      : "text-rose-500";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 -rotate-90", className)}
      aria-label={`配额剩余 ${clamped}%`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground/20"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={cn("transition-all duration-500 ease-out", colorClass)}
      />
    </svg>
  );
};

export interface QuotaCardProps {
  quota: UniversalQuotaState | null | undefined;
  agentTitle?: string;
  agentId?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  onSendStatus?: () => void;
  canSendStatus?: boolean;
  className?: string;
}

export const QuotaCard: React.FC<QuotaCardProps> = ({
  quota,
  agentTitle,
  agentId,
  onRefresh,
  refreshing = false,
  onSendStatus,
  canSendStatus = false,
  className,
}) => {
  if (!quota) {
    return (
      <div className={cn("p-3 rounded-lg border border-border/60 bg-muted/20 text-xs space-y-2", className)}>
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="font-medium text-foreground flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5" />
            配额与速率限制
          </span>
          {onRefresh && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              disabled={refreshing}
              className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("w-3 h-3 mr-1", refreshing && "animate-spin")} />
              {refreshing ? "探测中…" : "探测"}
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          暂未探测到本地额度数据。可连接后输入 <span className="font-mono text-foreground">/status</span> 刷新。
        </p>
      </div>
    );
  }

  const { account, primaryWindow, secondaryWindow, credits, extraWindows, status, message } = quota;

  const renderLimitBar = (window: QuotaLimitWindow, key: string) => {
    const left = Math.max(0, Math.min(100, Math.round(window.percentLeft ?? 100)));
    const colorClass =
      left > 40
        ? "bg-emerald-500"
        : left > 15
        ? "bg-amber-500"
        : "bg-rose-500";

    const badgeColor =
      left > 40
        ? "text-emerald-500 bg-emerald-500/10"
        : left > 15
        ? "text-amber-500 bg-amber-500/10"
        : "text-rose-500 bg-rose-500/10";

    return (
      <div key={key} className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium text-foreground/90">{window.label}</span>
          <div className="flex items-center gap-1.5">
            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-mono font-medium", badgeColor)}>
              {left}% 剩余
            </span>
            {window.resetsAt && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {String(window.resetsAt).replace(/^Resets in /i, "重置: ").replace(/^Resets /i, "重置: ")}
              </span>
            )}
          </div>
        </div>
        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500 ease-out", colorClass)}
            style={{ width: `${left}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className={cn("p-3 rounded-lg border border-border/70 bg-popover/80 shadow-xs space-y-2.5 text-xs", className)}>
      {/* 头部：账号与订阅计划 */}
      <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-foreground text-[12px] truncate">
              {account?.plan || agentTitle || agentId || "AI Agent"}
            </span>
            {status === "ok" && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] bg-emerald-500/10 text-emerald-500">
                <CheckCircle2 className="w-2.5 h-2.5" /> 正常
              </span>
            )}
            {status === "warning" && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] bg-amber-500/10 text-amber-500">
                <AlertTriangle className="w-2.5 h-2.5" /> 临界
              </span>
            )}
            {status === "exhausted" && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] bg-rose-500/10 text-rose-500">
                已耗尽
              </span>
            )}
          </div>
          {(account?.email || account?.name) && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1 truncate font-mono">
              <User className="w-3 h-3 shrink-0" />
              <span className="truncate">{account.email || account.name}</span>
            </div>
          )}
        </div>

        {onRefresh && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRefresh}
            disabled={refreshing}
            title="探测最新额度"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
          >
            <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />
          </Button>
        )}
      </div>

      {/* 警告消息 */}
      {message && (
        <div className="px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-500 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* 限额窗口 */}
      <div className="space-y-2">
        {primaryWindow && renderLimitBar(primaryWindow, "primary")}
        {secondaryWindow && renderLimitBar(secondaryWindow, "secondary")}
        {extraWindows && extraWindows.map((w, idx) => renderLimitBar(w, `extra-${idx}`))}
      </div>

      {/* 积分 / 余额 */}
      {credits && (
        <div className="pt-1.5 border-t border-border/50 flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground flex items-center gap-1">
            <CreditCard className="w-3 h-3" />
            账户余额 / Credits
          </span>
          <span className="font-mono font-medium text-foreground flex items-center gap-1">
            {credits.unlimited || credits.balance === "unlimited" ? (
              <span className="text-emerald-500 flex items-center gap-0.5">
                <Sparkles className="w-3 h-3" />
                无限制 (Unlimited)
              </span>
            ) : (
              <span>
                {credits.currency ? `${credits.currency} ` : ""}
                {credits.balance}
              </span>
            )}
          </span>
        </div>
      )}

      {/* 快捷操作：若会话在线，一键发送 /status */}
      {canSendStatus && onSendStatus && (
        <div className="pt-1 border-t border-border/50">
          <button
            type="button"
            onClick={onSendStatus}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded bg-muted/50 hover:bg-muted text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Send className="w-3 h-3" />
            <span>向会话发送 /status 刷新实时状态</span>
          </button>
        </div>
      )}
    </div>
  );
};
