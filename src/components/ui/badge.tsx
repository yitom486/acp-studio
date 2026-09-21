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
          "bg-primary/15 text-primary border border-primary/30":
            variant === "default",
          "bg-muted text-muted-foreground border border-border":
            variant === "secondary",
          "bg-destructive/15 text-destructive border border-destructive/30":
            variant === "destructive",
          "text-muted-foreground border border-border":
            variant === "outline",
          "bg-success/15 text-success border border-success/30":
            variant === "success",
          "bg-warning/15 text-warning border border-warning/30":
            variant === "warning",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
