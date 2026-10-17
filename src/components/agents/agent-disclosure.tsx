"use client";

import { type ComponentPropsWithRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AgentDisclosureProps extends ComponentPropsWithRef<"div"> {
  open: boolean;
  openHeight?: CSSProperties["height"];
  children?: ReactNode;
}

/** Shared transform-only reveal for collapsible agent content using CSS grid rows. */
export function AgentDisclosure({
  open,
  openHeight,
  className,
  style,
  children,
  ...props
}: AgentDisclosureProps) {
  return (
    <div
      {...props}
      aria-hidden={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
      style={{
        ...style,
        pointerEvents: open ? undefined : "none",
      }}
    >
      <div className="overflow-hidden">
        {children}
      </div>
    </div>
  );
}
