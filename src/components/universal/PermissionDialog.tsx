import React from "react";
import ApprovalCard, { type ApprovalQuestion } from "@/components/primitives/ApprovalCard";
import type { PendingPermission } from "@/lib/universal-api";

export interface PermissionDialogProps {
  pending: PendingPermission[];
  onRespond: (p: PendingPermission, optionId: string | null) => void;
  respondingId: string | null;
  className?: string;
}

export const PermissionDialog: React.FC<PermissionDialogProps> = ({ pending, onRespond, respondingId, className }) => {
  if (pending.length === 0) return null;
  return (
    <div className={`space-y-2.5 ${className || ""}`}>
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
  const tool = p.toolCall as any;
  const toolTitle = tool?.title || tool?.toolCallId || p.permissionId;
  const kind = tool?.kind ? `[${tool.kind}] ` : "";

  const question: ApprovalQuestion = {
    q: `【安全授权】执行 ${kind}${toolTitle}`,
    type: "radio",
    options: (p.options || []).map((o) => o.name || o.optionId),
  };

  return (
    <ApprovalCard
      questions={[question]}
      labels={{
        skip: "拒绝",
        continue: "授权执行",
        send: busy ? "提交中…" : "批准执行",
        customPlaceholder: "说明或参数补充（可选）…",
        sentMessage: "授权请求已处理",
      }}
      onSubmitted={(answers) => {
        const selectedIdx = answers[0]?.[0] ?? 0;
        const optionId = p.options?.[selectedIdx]?.optionId || null;
        onRespond(p, optionId);
      }}
      onDismiss={() => {
        onRespond(p, null);
      }}
      className="w-full max-w-full"
    />
  );
}
