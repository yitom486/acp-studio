/**
 * 底部状态栏（VSCode 式）：左 = 远程角标，右 = 网关/工作区速览。
 * 瘦条，不断流式热路径（只订阅工作区字符串）。
 */
import React from "react";
import { RemoteButton } from "./RemoteButton";
import { useStudioStore } from "@/stores/useStudioStore";
import { getGatewayBase, gatewayHost } from "@/lib/gateway-auth";

export const StatusBar: React.FC = () => {
  const cwd = useStudioStore((s) => s.currentWorkspace);
  const base = getGatewayBase();
  const rootName = (cwd || "").split(/[\\/]/).filter(Boolean).pop() || "";
  return (
    <footer className="flex h-6 shrink-0 items-stretch justify-between border-t border-border bg-muted/40 text-[11px] select-none">
      <RemoteButton />
      <div className="flex min-w-0 items-center gap-3 px-2 text-muted-foreground">
        {base ? (
          <span className="font-mono truncate" title={base}>
            经 {gatewayHost(base)}
          </span>
        ) : null}
        {cwd ? (
          <span className="font-mono truncate" title={cwd}>
            {rootName}
          </span>
        ) : null}
      </div>
    </footer>
  );
};
