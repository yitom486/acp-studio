"use client";

import { Check, CircleAlert, RotateCcw } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { EASE_IN_OUT, EASE_OUT, SPRING_PRESS } from "@/lib/motion-primitives";
import { cn } from "@/lib/utils";

export type ImageGenerationStatus =
  | "queued"
  | "generating"
  | "refining"
  | "complete"
  | "error";

export interface ImageGenerationProps {
  /** The completed media. Pass an img, video, canvas, or custom preview. */
  children?: ReactNode;
  status?: ImageGenerationStatus;
  /** Accessible description. Defaults to a description derived from prompt. */
  label?: string;
  prompt?: string;
  resolution?: string;
  /** CSS aspect ratio reserved before generated media is available. */
  aspectRatio?: CSSProperties["aspectRatio"];
  size?: "compact" | "fluid";
  /** Lets the active dither cluster follow fine-pointer movement. */
  interactive?: boolean;
  statusText?: string;
  showStatus?: boolean;
  onRetry?: () => void;
  className?: string;
  mediaClassName?: string;
  statusClassName?: string;
}

const STATUS_TEXT: Record<ImageGenerationStatus, string> = {
  queued: "排队准备生成",
  generating: "正在渲染像素",
  refining: "细化细节与降噪",
  complete: "图像生成完成",
  error: "生成失败",
};

const MEDIA_STATE: Record<
  ImageGenerationStatus,
  { filter: string; opacity: number; scale: number }
> = {
  queued: { filter: "blur(4px) saturate(0.75)", opacity: 0, scale: 1.02 },
  generating: { filter: "blur(3px) saturate(0.85)", opacity: 0, scale: 1.015 },
  refining: { filter: "blur(1.5px) saturate(0.95)", opacity: 0.62, scale: 1.005 },
  complete: { filter: "blur(0px) saturate(1)", opacity: 1, scale: 1 },
  error: { filter: "blur(2px) saturate(0.5)", opacity: 0.28, scale: 1 },
};

const OVERLAY_OPACITY: Record<ImageGenerationStatus, number> = {
  queued: 1,
  generating: 1,
  refining: 0.48,
  complete: 0,
  error: 0,
};

const DOT_GAP = 10;
const TWO_PI = Math.PI * 2;

function DitherMark({
  status,
  reduce,
}: {
  status: ImageGenerationStatus;
  reduce: boolean;
}) {
  if (status === "complete") {
    return <Check aria-hidden="true" className="size-3.5 text-emerald-500" />;
  }

  if (status === "error") {
    return <CircleAlert aria-hidden="true" className="size-3.5 text-destructive" />;
  }

  return (
    <motion.span
      aria-hidden="true"
      animate={reduce ? undefined : { rotate: 360 }}
      transition={{
        duration: 2.4,
        ease: EASE_IN_OUT,
        repeat: Number.POSITIVE_INFINITY,
      }}
      className="grid size-3.5 grid-cols-2 place-items-center gap-0.5 text-primary"
    >
      <span className="size-1 rounded-[1px] bg-current" />
      <span className="size-1 rounded-[1px] bg-current opacity-55" />
      <span className="size-1 rounded-[1px] bg-current opacity-55" />
      <span className="size-1 rounded-[1px] bg-current" />
    </motion.span>
  );
}

function DitherField({
  interactive,
  reduce,
  status,
}: {
  interactive: boolean;
  reduce: boolean;
  status: ImageGenerationStatus;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let dotColor = "currentColor";
    const pointer = {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      inside: false,
    };
    const pointerEnabled = interactive && !reduce;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width || canvas.clientWidth || 220;
      height = rect.height || canvas.clientHeight || 220;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      dotColor = window.getComputedStyle(canvas).color || "#888888";
      pointer.x = width / 2;
      pointer.y = height / 2;
      pointer.targetX = pointer.x;
      pointer.targetY = pointer.y;
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);

      if (!pointer.inside) {
        pointer.targetX =
          width / 2 + (reduce ? 0 : Math.sin(time / 1700) * width * 0.12);
        pointer.targetY =
          height / 2 + (reduce ? 0 : Math.cos(time / 2100) * height * 0.1);
      }

      const follow = reduce ? 1 : pointer.inside ? 0.16 : 0.045;
      pointer.x += (pointer.targetX - pointer.x) * follow;
      pointer.y += (pointer.targetY - pointer.y) * follow;

      const radius = Math.min(width, height) * 0.38;
      const columns = Math.ceil(width / DOT_GAP) + 1;
      const rows = Math.ceil(height / DOT_GAP) + 1;
      const offsetX = (width - (columns - 1) * DOT_GAP) / 2;
      const offsetY = (height - (rows - 1) * DOT_GAP) / 2;

      context.fillStyle = dotColor;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const anchorX = offsetX + column * DOT_GAP;
          const anchorY = offsetY + row * DOT_GAP;
          const deltaX = anchorX - pointer.x;
          const deltaY = anchorY - pointer.y;
          const distance = Math.hypot(deltaX, deltaY);
          const proximity = Math.max(0, 1 - distance / radius);
          const influence = proximity * proximity * (3 - 2 * proximity);
          const displacement = influence * influence * 9;
          const directionX = distance > 0 ? deltaX / distance : 0;
          const directionY = distance > 0 ? deltaY / distance : 0;
          const x = anchorX + directionX * displacement;
          const y = anchorY + directionY * displacement;
          const dotRadius = 0.65 + influence * 0.85;

          context.globalAlpha = 0.18 + influence * 0.72;
          context.beginPath();
          context.arc(x, y, dotRadius, 0, TWO_PI);
          context.fill();
        }
      }

      context.globalAlpha = 1;
      if (!reduce) frame = window.requestAnimationFrame(draw);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerEnabled) return;
      const rect = canvas.getBoundingClientRect();
      pointer.inside = true;
      pointer.targetX = event.clientX - rect.left;
      pointer.targetY = event.clientY - rect.top;
    };

    const handlePointerLeave = () => {
      pointer.inside = false;
    };

    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(resize);

    resize();
    ro?.observe(canvas);
    canvas.addEventListener("pointermove", handlePointerMove, { passive: true });
    canvas.addEventListener("pointerleave", handlePointerLeave);
    draw(0);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      ro?.disconnect();
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [interactive, reduce]);

  return (
    <motion.div
      aria-hidden="true"
      initial={false}
      animate={{ opacity: OVERLAY_OPACITY[status] }}
      transition={{ duration: reduce ? 0 : 0.4, ease: EASE_OUT }}
      className="absolute inset-0 overflow-hidden bg-muted"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full text-foreground/70"
      />
    </motion.div>
  );
}

export function ImageGeneration({
  children,
  status = "generating",
  label,
  prompt,
  resolution = "1024 × 1024",
  aspectRatio = "1 / 1",
  size = "compact",
  interactive = true,
  statusText,
  showStatus = true,
  onRetry,
  className,
  mediaClassName,
  statusClassName,
}: ImageGenerationProps) {
  const reduce = useReducedMotion() ?? false;
  const active =
    status === "queued" || status === "generating" || status === "refining";
  const mediaState = MEDIA_STATE[status];
  const resolvedStatusText = statusText ?? STATUS_TEXT[status];
  const resolvedLabel =
    label ?? (prompt ? `${resolvedStatusText}: ${prompt}` : resolvedStatusText);

  return (
    <div
      data-slot="image-generation"
      data-state={status}
      aria-busy={active}
      className={cn("w-full select-none", className)}
    >
      <div
        className={cn(
          "w-full",
          size === "compact" && "mx-auto max-w-64",
        )}
      >
        <div
          role="img"
          aria-label={resolvedLabel}
          style={{ aspectRatio }}
          className="relative isolate w-full overflow-hidden rounded-2xl border border-border/80 bg-muted/80 shadow-md backdrop-blur-xs"
        >
          <motion.div
            aria-hidden={children ? undefined : true}
            initial={false}
            animate={
              reduce
                ? { opacity: mediaState.opacity }
                : {
                    filter: mediaState.filter,
                    opacity: mediaState.opacity,
                    scale: mediaState.scale,
                  }
            }
            transition={
              reduce ? { duration: 0 } : { duration: 0.4, ease: EASE_OUT }
            }
            className={cn(
              "absolute inset-0 [&>*]:size-full [&>*]:object-cover [&_img]:size-full [&_img]:object-cover",
              mediaClassName,
            )}
          >
            {children}
          </motion.div>

          <AnimatePresence initial={false}>
            {active ? (
              <motion.div
                key="dither-field"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.25, ease: EASE_OUT }}
                className="absolute inset-0"
              >
                <DitherField
                  interactive={interactive}
                  reduce={reduce}
                  status={status}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {resolution ? (
            <span className="absolute top-2.5 right-2.5 z-10 rounded-full border border-border/60 bg-background/80 px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground backdrop-blur-md shadow-xs">
              {resolution}
            </span>
          ) : null}
        </div>

        {showStatus || prompt ? (
          <div className="mt-2.5 text-left px-0.5">
            {showStatus ? (
              <div
                aria-live="polite"
                className={cn(
                  "flex min-h-5 items-center gap-2 text-xs font-medium text-foreground",
                  status === "error" && "text-destructive",
                  statusClassName,
                )}
              >
                <DitherMark status={status} reduce={reduce} />
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={resolvedStatusText}
                    initial={reduce ? false : { opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -3 }}
                    transition={{
                      duration: reduce ? 0 : 0.15,
                      ease: EASE_OUT,
                    }}
                  >
                    {resolvedStatusText}
                  </motion.span>
                </AnimatePresence>
              </div>
            ) : null}
            {prompt ? (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={prompt}>
                “{prompt}”
              </p>
            ) : null}
          </div>
        ) : null}

        {status === "error" && onRetry ? (
          <motion.button
            type="button"
            onClick={onRetry}
            whileTap={reduce ? undefined : { scale: 0.96 }}
            transition={SPRING_PRESS}
            className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            重试生成
          </motion.button>
        ) : null}
      </div>
    </div>
  );
}
