import React, { useState } from "react";
import { ShieldAlert, Check, X } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import GlideMenu from "@/components/primitives/GlideMenu";
import type { PendingPermission } from "@/lib/universal-api";

export interface PermissionDialogProps {
  pending: PendingPermission[];
  onRespond: (p: PendingPermission, optionId: string | null) => void;
  respondingId: string | null;
}

export const PermissionDialog: React.FC<PermissionDialogProps> = ({ pending, onRespond, respondingId }) => {
  if (pending.length === 0) return null;
  return (
    <div className="px-4 pt-2.5 space-y-2.5">
      {pending.map((p) => (
        <PermissionCard key={p.permissionId} p={p} onRespond={onRespond} busy={respondingId === p.permissionId} />
      ))}
    </div>
  );
};

function PermissionCard({
  p,
  onRespond,
  busy,
}: {
  p: PendingPermission;
  onRespond: PermissionDialogProps["onRespond"];
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string>(p.options?.[0]?.optionId || "");
  const [sent, setSent] = useState(false);
  const tool = p.toolCall as any;
  const toolTitle = tool?.title || tool?.toolCallId || p.permissionId;

  const handleApprove = () => {
    if (!selected || busy) return;
    setSent(true);
    onRespond(p, selected);
  };

  const handleDeny = () => {
    if (busy) return;
    setSent(true);
    onRespond(p, null);
  };

  if (sent) {
    return (
      <div
        className="flex w-full items-center gap-3 rounded-card bg-surface/90 border border-line px-3.5 py-2.5 shadow-sm"
        style={{ animation: "pop-in 260ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-tint py-1 pr-3 pl-1.5 text-[12.5px] font-medium text-green">
          <span className="flex size-4.5 items-center justify-center rounded-full bg-green text-white">
            <Check className="w-3 h-3 stroke-[3]" />
          </span>
          授权请求已处理
        </span>
        <span className="text-[12px] font-mono text-ink-3 truncate max-w-[200px]">{toolTitle}</span>
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-card bg-surface shadow-card border border-line transition-all duration-300"
      style={{ animation: "fade-up 320ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      {/* 顶部标题栏 */}
      <div className="flex items-center gap-2 border-b border-line/60 px-3.5 py-2.5 bg-inset/40">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
          <ShieldAlert className="w-3.5 h-3.5" />
        </span>
        <span className="font-semibold text-[13px] text-ink shrink-0">需要授权</span>
        <span className="text-ink-2 text-[12px] truncate font-mono max-w-[280px]" title={toolTitle}>
          {toolTitle}
        </span>
        <span className="ml-auto font-mono text-[10px] text-ink-3 shrink-0">
          {tool?.kind ? `${tool.kind} · ` : ""}
          {p.sessionId.slice(0, 8)}
        </span>
      </div>

      {/* 选项列表（带 GlideMenu 滑动指示器） */}
      <div className="p-3">
        <div className="text-[12px] text-ink-2 mb-2 font-medium">请选择授权方案：</div>
        <GlideMenu className="flex flex-col gap-1" highlightClassName="inset-x-0 rounded-control bg-hover">
          {(p.options || []).map((o) => {
            const on = selected === o.optionId;
            return (
              <button
                key={o.optionId}
                type="button"
                data-menu-row
                aria-pressed={on}
                onClick={() => setSelected(o.optionId)}
                className="relative z-10 flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left transition-colors duration-100 cursor-pointer"
              >
                <span
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${
                    on ? "bg-ink text-canvas" : "shadow-[inset_0_0_0_1.5px_var(--line-strong)] text-transparent"
                  }`}
                >
                  <span
                    className="size-1.5 rounded-full bg-canvas transition-transform duration-200"
                    style={{ transform: on ? "scale(1)" : "scale(0)" }}
                  />
                </span>
                <span className={`text-[12.5px] leading-snug transition-colors duration-200 ${on ? "text-ink font-medium" : "text-ink-2"}`}>
                  {o.name}
                </span>
                {o.kind && (
                  <span className="ml-auto text-[10px] font-mono text-ink-3 opacity-70">
                    {o.kind}
                  </span>
                )}
              </button>
            );
          })}
        </GlideMenu>
      </div>

      {/* 底部 Pill 按钮栏 */}
      <div className="flex items-center justify-between gap-3 border-t border-line/70 px-3.5 py-2.5 bg-inset/50">
        <span className="text-[11px] font-mono text-ink-3">
          {busy ? "正在提交回应…" : "等待用户确认"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={handleDeny}
            className="text-red hover:bg-red-tint"
          >
            <X className="w-3 h-3 mr-0.5" />
            拒绝
          </Button>
          <Button
            variant="primary"
            size="xs"
            disabled={busy || !selected}
            onClick={handleApprove}
          >
            <Check className="w-3 h-3 mr-0.5" />
            {busy ? "提交中…" : "批准所选"}
          </Button>
        </div>
      </div>
    </div>
  );
}
