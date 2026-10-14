"use client";

import {
  forwardRef,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { SPRING_PRESS, SPRING_SWAP } from "@/lib/motion-primitives";
import { cn } from "@/lib/utils";

// ---------- MagneticButton ----------

export interface MagneticButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  /** Attraction intensity multiplier (0 to 1). Default 0.25 */
  strength?: number;
  /** Custom spring configuration for the magnetic tracking */
  springConfig?: { stiffness?: number; damping?: number; mass?: number };
}

export const MagneticButton = forwardRef<HTMLButtonElement, MagneticButtonProps>(
  function MagneticButton(
    {
      children,
      strength = 0.25,
      springConfig = { stiffness: 180, damping: 14, mass: 0.15 },
      className,
      onPointerMove,
      onPointerLeave,
      disabled,
      ...props
    },
    ref,
  ) {
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const prefersReducedMotion = useReducedMotion();

    const x = useMotionValue(0);
    const y = useMotionValue(0);

    const springX = useSpring(x, springConfig);
    const springY = useSpring(y, springConfig);

    const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
      onPointerMove?.(e);
      if (disabled || prefersReducedMotion) return;

      const btn = buttonRef.current;
      if (!btn) return;

      const rect = btn.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const deltaX = (e.clientX - centerX) * strength;
      const deltaY = (e.clientY - centerY) * strength;

      x.set(deltaX);
      y.set(deltaY);
    };

    const handlePointerLeave = (e: PointerEvent<HTMLButtonElement>) => {
      onPointerLeave?.(e);
      x.set(0);
      y.set(0);
    };

    return (
      <motion.button
        ref={(node) => {
          buttonRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        data-slot="magnetic-button"
        style={{
          x: prefersReducedMotion ? 0 : springX,
          y: prefersReducedMotion ? 0 : springY,
        }}
        whileTap={disabled ? undefined : { scale: 0.94 }}
        transition={SPRING_PRESS}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center select-none transition-colors",
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        {...(props as any)}
      >
        {children}
      </motion.button>
    );
  },
);

MagneticButton.displayName = "MagneticButton";

// ---------- ActionSwap ----------

export interface ActionSwapProps {
  /** Identifier of the currently active state */
  stateKey: string | number;
  /** Children or map of state views */
  children: ReactNode;
  /** Direction of the cross-fade animation */
  direction?: "vertical" | "horizontal";
  className?: string;
}

export function ActionSwap({
  stateKey,
  children,
  direction = "vertical",
  className,
}: ActionSwapProps) {
  const prefersReducedMotion = useReducedMotion();

  const isVertical = direction === "vertical";
  const initialOffset = isVertical ? 6 : 8;

  return (
    <span
      data-slot="action-swap-container"
      className={cn("relative inline-flex items-center justify-center overflow-hidden", className)}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={stateKey}
          data-slot="action-swap-content"
          initial={
            prefersReducedMotion
              ? { opacity: 0 }
              : {
                  opacity: 0,
                  y: isVertical ? initialOffset : 0,
                  x: !isVertical ? initialOffset : 0,
                  filter: "blur(4px)",
                }
          }
          animate={{
            opacity: 1,
            y: 0,
            x: 0,
            filter: "blur(0px)",
          }}
          exit={
            prefersReducedMotion
              ? { opacity: 0 }
              : {
                  opacity: 0,
                  y: isVertical ? -initialOffset : 0,
                  x: !isVertical ? -initialOffset : 0,
                  filter: "blur(4px)",
                }
          }
          transition={SPRING_SWAP}
          className="inline-flex items-center justify-center gap-1.5"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// ---------- StatefulButton ----------

export type ButtonStatus = "idle" | "loading" | "success" | "error";

export interface StatefulButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  status?: ButtonStatus;
  idleText?: ReactNode;
  loadingText?: ReactNode;
  successText?: ReactNode;
  errorText?: ReactNode;
  idleIcon?: ReactNode;
  loadingIcon?: ReactNode;
  successIcon?: ReactNode;
  errorIcon?: ReactNode;
  strength?: number;
}

export const StatefulButton = forwardRef<HTMLButtonElement, StatefulButtonProps>(
  function StatefulButton(
    {
      status = "idle",
      idleText,
      loadingText = "处理中…",
      successText = "已完成",
      errorText = "失败",
      idleIcon,
      loadingIcon = <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      successIcon = <Check className="w-3.5 h-3.5 text-success" />,
      errorIcon = <X className="w-3.5 h-3.5 text-destructive" />,
      children,
      disabled,
      className,
      strength = 0.2,
      ...props
    },
    ref,
  ) {
    const isLoading = status === "loading";
    const currentText =
      status === "loading"
        ? loadingText
        : status === "success"
          ? successText
          : status === "error"
            ? errorText
            : idleText ?? children;

    const currentIcon =
      status === "loading"
        ? loadingIcon
        : status === "success"
          ? successIcon
          : status === "error"
            ? errorIcon
            : idleIcon;

    return (
      <MagneticButton
        ref={ref}
        strength={strength}
        disabled={disabled || isLoading}
        className={cn(
          "px-3 py-1.5 rounded-lg text-xs font-medium border border-border shadow-xs",
          status === "idle" && "bg-card text-foreground hover:bg-accent",
          status === "loading" && "bg-muted text-muted-foreground",
          status === "success" && "border-success/40 bg-success/10 text-success",
          status === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
          className,
        )}
        {...props}
      >
        <ActionSwap stateKey={status}>
          {currentIcon}
          {currentText && <span>{currentText}</span>}
        </ActionSwap>
      </MagneticButton>
    );
  },
);

StatefulButton.displayName = "StatefulButton";
