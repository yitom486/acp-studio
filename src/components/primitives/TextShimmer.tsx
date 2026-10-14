"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const TEXT_SHIMMER_KEYFRAMES = `
@keyframes beui-text-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .beui-text-shimmer { animation: none !important; }
}
`;

export const TEXT_SHIMMER_CLASS_NAME =
  "beui-text-shimmer bg-[length:200%_100%] bg-clip-text text-transparent bg-[linear-gradient(110deg,var(--muted-foreground)_30%,var(--foreground)_50%,var(--muted-foreground)_70%)]";

export function textShimmerStyle(duration: number): CSSProperties {
  return {
    animation: `beui-text-shimmer ${duration}s linear infinite`,
  };
}

export interface TextShimmerProps {
  children: ReactNode;
  as?: ElementType;
  duration?: number;
  className?: string;
}

export function TextShimmer({
  children,
  as: Comp = "span",
  duration = 2.5,
  className,
}: TextShimmerProps) {
  return (
    <>
      <style>{TEXT_SHIMMER_KEYFRAMES}</style>
      <Comp
        style={textShimmerStyle(duration)}
        className={cn("inline-block", TEXT_SHIMMER_CLASS_NAME, className)}
      >
        {children}
      </Comp>
    </>
  );
}

export interface ThinkingShimmerProps {
  children?: ReactNode;
  duration?: number;
  className?: string;
}

export function ThinkingShimmer({
  children = "正在深度思考…",
  duration = 1.8,
  className,
}: ThinkingShimmerProps) {
  return (
    <TextShimmer
      as="span"
      duration={duration}
      className={cn("font-medium", className)}
    >
      {children}
    </TextShimmer>
  );
}
