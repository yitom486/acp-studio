/**
 * shadcn/ui Resizable（基于 react-resizable-panels v4：Group / Panel / Separator）。
 */
import * as React from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";

export function ResizablePanelGroup({ className, ...props }: React.ComponentProps<typeof Group>) {
  return <Group data-slot="resizable-panel-group" className={cn("flex h-full w-full", className)} {...props} />;
}

export function ResizablePanel(props: React.ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

export function ResizableHandle({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px shrink-0 items-center justify-center bg-border outline-none transition-colors",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2",
        "hover:bg-foreground/30 data-[separator=active]:bg-foreground/50 focus-visible:bg-ring",
        className,
      )}
      {...props}
    />
  );
}
