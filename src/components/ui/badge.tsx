import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
        // Sanctioned project extension (not upstream): status badges used
        // across AgentBar/Sidebar/Providers. Token-only, per ui_design.md.
        success:
          "border-success/30 bg-success/15 text-success",
        warning:
          "border-warning/30 bg-warning/15 text-warning",
        // 中性“待定”状态（如 git 未跟踪）：虚线描边 + 次要文字色，
        // 不占用琥珀色（琥珀只留给聚焦/运行中/当前会话这类实时状态）。
        neutral:
          "border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
