"use client";
// beui.dev/components/agents/loading-states

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { type ReactNode, useId } from "react";
import { Loader } from "@/components/motion/loader";
import { TextScramble } from "@/components/motion/text-scramble";
import { EASE_OUT, SPRING_SWAP } from "@/lib/ease";
import {
  TEXT_SHIMMER_CLASS_NAME,
  TEXT_SHIMMER_KEYFRAMES,
  textShimmerStyle,
} from "@/lib/text-shimmer";
import { cn } from "@/lib/utils";

const CASCADE_STAGGER = 0.025;

export type ReasoningTextVariant = "cascade" | "swap" | "scramble";

export interface ReasoningTextProps {
  /** 当前状态文案（唯一真实数据源，来自后端事件）。 */
  text?: string;
  /** 兼容 phrases 数组传入（取当前首项，杜绝定时器循环假象）。 */
  phrases?: string[];
  /** Animation used when the active phrase changes. */
  variant?: ReasoningTextVariant;
  /** Seconds taken for one shimmer pass. */
  shimmerDuration?: number;
  /** Optional leading visual. Defaults to a terminal-style ASCII loader. */
  indicator?: ReactNode;
  className?: string;
}

type PhraseProps = {
  phrase: string;
  reduce: boolean;
  shimmerDuration: number;
};

function CascadePhrase({
  phrase,
  reduce,
  shimmerDuration,
}: PhraseProps) {
  const text = `${phrase}…`;

  if (reduce) {
    return (
      <span
        className={cn(
          "col-start-1 row-start-1 inline-block justify-self-start whitespace-pre",
          TEXT_SHIMMER_CLASS_NAME,
        )}
        style={textShimmerStyle(shimmerDuration)}
      >
        {text}
      </span>
    );
  }

  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={phrase}
        className="col-start-1 row-start-1 inline-block justify-self-start whitespace-pre"
        initial="initial"
        animate="animate"
        exit="exit"
      >
        {text.split("").map((character, characterIndex) => (
          <motion.span
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the stable cascade slot identity.
            key={characterIndex}
            custom={characterIndex * CASCADE_STAGGER}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={{
              initial: { opacity: 0, y: 6 },
              animate: (delay: number) => ({
                opacity: 1,
                y: 0,
                transition: { ...SPRING_SWAP, delay },
              }),
              exit: (delay: number) => ({
                opacity: 0,
                y: -6,
                transition: {
                  duration: 0.14,
                  ease: EASE_OUT,
                  delay: delay * 0.45,
                },
              }),
            }}
            className={cn(
              "inline-block whitespace-pre will-change-[opacity,transform]",
              TEXT_SHIMMER_CLASS_NAME,
            )}
            style={textShimmerStyle(shimmerDuration)}
          >
            {character}
          </motion.span>
        ))}
      </motion.span>
    </AnimatePresence>
  );
}

function SwapPhrase({ phrase, reduce, shimmerDuration }: PhraseProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={phrase}
        className={cn(
          "col-start-1 row-start-1 inline-block justify-self-start whitespace-nowrap will-change-[opacity,transform]",
          TEXT_SHIMMER_CLASS_NAME,
        )}
        style={textShimmerStyle(shimmerDuration)}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -2 }}
        transition={{
          duration: reduce ? 0.12 : 0.25,
          ease: EASE_OUT,
        }}
      >
        {phrase}…
      </motion.span>
    </AnimatePresence>
  );
}

function ScramblePhrase({
  phrase,
  shimmerDuration,
}: PhraseProps) {
  const target = `${phrase}…`;

  return (
    <TextScramble
      text={target}
      className={cn(
        "col-start-1 row-start-1 justify-self-start tabular-nums",
        TEXT_SHIMMER_CLASS_NAME,
      )}
      style={textShimmerStyle(shimmerDuration)}
    />
  );
}

export function ReasoningText({
  text,
  phrases,
  variant = "cascade",
  shimmerDuration = 2.2,
  indicator,
  className,
}: ReasoningTextProps) {
  const reduce = (useReducedMotion() ?? false) || process.env.NODE_ENV === "test";
  const statusId = useId();

  // 严禁前端轮播假状态：严格消费真实传入的文案。省略号统一规范由下层补全。
  const rawText = (text ?? phrases?.[0] ?? "正在思考").trim();
  const phrase = rawText.replace(/[…\.\s]+$/, "") || "正在思考";
  const phraseProps = { phrase, reduce, shimmerDuration };

  return (
    <>
      <style>{TEXT_SHIMMER_KEYFRAMES}</style>
      <span
        role="status"
        aria-live="polite"
        aria-labelledby={statusId}
        className={cn(
          "inline-flex items-center gap-2 text-sm font-medium text-muted-foreground",
          className,
        )}
      >
        <span aria-hidden="true" className="inline-flex size-3 shrink-0 items-center justify-center">
          {indicator ?? (
            <Loader
              variant="ascii-line"
              size={14}
              speed={0.8}
              label={phrase}
            />
          )}
        </span>

        <span aria-hidden="true" className="grid overflow-hidden text-left">
          <span className="invisible col-start-1 row-start-1 whitespace-nowrap">
            {phrase}…
          </span>
          {variant === "cascade" ? (
            <CascadePhrase {...phraseProps} />
          ) : variant === "scramble" ? (
            <ScramblePhrase {...phraseProps} />
          ) : (
            <SwapPhrase {...phraseProps} />
          )}
        </span>

        <span id={statusId} className="sr-only">
          {phrase}
        </span>
      </span>
    </>
  );
}
