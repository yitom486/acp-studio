import React, { useState } from "react";
import { ShieldAlert, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BlurFade } from "@/components/magicui/blur-fade";
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
        <BlurFade key={p.permissionId} delay={0.05 * Math.min(i, 3)}>
          <PermissionCard p={p} onRespond={onRespond} busy={respondingId === p.permissionId} />
        </BlurFade>
      ))}
    </div>
  );
};

function PermissionCard({ p, onRespond, busy }: { p: PendingPermission; onRespond: PermissionDialogProps["onRespond"]; busy: boolean }) {
  const [selected, setSelected] = useState<string>(p.options?.[0]?.optionId || "");
  const tool = p.toolCall as any;
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/30 p-3 text-xs space-y-2">
      <div className="flex items-center gap-2 text-warning font-semibold">
        <ShieldAlert className="w-4 h-4" />
        <span>需要授权 · {tool?.title || tool?.toolCallId || p.permissionId}</span>
        <span className="ml-auto font-mono text-[10px] text-warning/70">{p.sessionId.slice(0, 8)}</span>
      </div>
      {tool?.kind && <div className="text-warning/70 font-mono text-[11px]">kind: {tool.kind}</div>}
      <div className="flex flex-wrap gap-1.5">
        {(p.options || []).map((o) => (
          <button
            key={o.optionId}
            onClick={() => setSelected(o.optionId)}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              selected === o.optionId
                ? "bg-warning text-warning-foreground border-warning"
                : "border-warning/30 text-warning hover:border-warning"
            }`}
          >
            {o.name} ({o.kind || o.optionId})
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="default" disabled={busy || !selected} onClick={() => onRespond(p, selected)} className="h-7 text-xs gap-1">
          <Check className="w-3 h-3" />
          {busy ? "提交中..." : "批准所选"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onRespond(p, null)} className="h-7 text-xs">
          拒绝 / 取消
        </Button>
      </div>
    </div>
  );
}
