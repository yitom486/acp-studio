import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}

function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        {
          "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30":
            variant === "default",
          "bg-slate-800 text-slate-300 border border-slate-700":
            variant === "secondary",
          "bg-rose-500/20 text-rose-300 border border-rose-500/30":
            variant === "destructive",
          "text-slate-300 border border-slate-700":
            variant === "outline",
          "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30":
            variant === "success",
          "bg-amber-500/20 text-amber-300 border border-amber-500/30":
            variant === "warning",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
