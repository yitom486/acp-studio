import React, { useState } from "react";
import { ShieldAlert, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PendingPermission } from "@/lib/universal-api";

export interface PermissionDialogProps {
  pending: PendingPermission[];
  onRespond: (p: PendingPermission, optionId: string | null) => void;
  respondingId: string | null;
}

export const PermissionDialog: React.FC<PermissionDialogProps> = ({ pending, onRespond, respondingId }) => {
  if (pending.length === 0) return null;
  return (
    <div className="px-4 pt-2 space-y-2">
      {pending.map((p, i) => (
        <div key={p.permissionId}>
          <PermissionCard p={p} onRespond={onRespond} busy={respondingId === p.permissionId} />
        </div>
      ))}
    </div>
  );
};

function PermissionCard({ p, onRespond, busy }: { p: PendingPermission; onRespond: PermissionDialogProps["onRespond"]; busy: boolean }) {
  const [selected, setSelected] = useState<string>(p.options?.[0]?.optionId || "");
  const tool = p.toolCall as any;
  // 单色卡片：琥珀只用于左侧细条和盾牌图标（“等你处理”的实时状态），
  // 选项与按钮走中性色，不再整块填充警告色。
  return (
    <div className="rounded-lg border border-border border-l-2 border-l-signal bg-card p-3 text-xs space-y-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <ShieldAlert className="w-4 h-4 text-signal shrink-0" />
        <span className="font-medium text-foreground shrink-0">需要授权</span>
        <span className="text-foreground truncate">{tool?.title || tool?.toolCallId || p.permissionId}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground shrink-0">
          {tool?.kind ? `${tool.kind} · ` : ""}
          {p.sessionId.slice(0, 8)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="授权选项">
        {(p.options || []).map((o) => (
          <button
            key={o.optionId}
            type="button"
            role="radio"
            aria-checked={selected === o.optionId}
            onClick={() => setSelected(o.optionId)}
            title={o.kind || o.optionId}
            className={`h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors ${
              selected === o.optionId
                ? "border-foreground text-foreground bg-accent"
                : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            {o.name}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="default" disabled={busy || !selected} onClick={() => onRespond(p, selected)} className="h-7 text-xs gap-1">
          <Check className="w-3 h-3" />
          {busy ? "提交中..." : "批准所选"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onRespond(p, null)} className="h-7 text-xs">
          拒绝
        </Button>
      </div>
    </div>
  );
}
