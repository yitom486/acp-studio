"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────
 * THINKING — expandable agent trace
 *
 *   Steps      step list with spinner → muted checks
 *   Reasoning  prose reasoning that expands, then settles
 *   Search     web-search trace: query + sources read
 *   Coding     tool trace: files read, edits, commands
 *
 * The trace runs once, settles, and remains expandable.
 * ───────────────────────────────────────────────────────── */

const STAGES = [800, 600, 1800, 2600, 1600];

function useSequence(steps: number[], active: boolean = true) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!active || stage >= steps.length - 1) return;
    const t = setTimeout(() => setStage((s) => s + 1), steps[stage]);
    return () => clearTimeout(t);
  }, [stage, steps, active]);
  return stage;
}

export type ThinkingRow = {
  primary: string;
  secondary?: string;
  mono?: boolean;
  add?: number;
  del?: number;
  href?: string;
};

const VARIANTS: Record<
  string,
  { active: string; done: string; rows: ThinkingRow[]; query?: string }
> = {
  Steps: {
    active: "正在思考",
    done: "思考完成",
    rows: [
      { primary: "解析任务目标与上下文" },
      { primary: "检索相关代码和符号定义" },
      { primary: "分析依赖与调用链" },
      { primary: "构建并生成回复" },
    ],
  },
  Reasoning: {
    active: "正在思考",
    done: "思考过程",
    rows: [
      { primary: "正在分析项目架构并推理最合理的改动方案…" },
    ],
  },
  Search: {
    active: "正在搜索",
    done: "搜索完成",
    query: "检索上下文",
    rows: [],
  },
  Coding: {
    active: "正在执行工具",
    done: "工具执行完成",
    rows: [],
  },
};

function Dot({ tone }: { tone: string }) {
  return (
    <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-full text-white ${tone}`}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="9" />
        <path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    </span>
  );
}

const TONES = ["bg-accent", "bg-orange", "bg-green"];

export default function ThinkingState({
  variant = "Steps",
  onSettled,
  rows,
  active,
  done,
  icon,
  isWorking,
  className,
}: {
  variant?: string;
  onSettled?: () => void;
  /** override the built-in trace content (keeps the primitive reusable) */
  rows?: ThinkingRow[];
  active?: string;
  done?: string;
  /** override the header glyph (defaults to the sparkle) */
  icon?: ReactNode;
  isWorking?: boolean;
  className?: string;
}) {
  const isControlled = typeof isWorking === "boolean";
  const stage = useSequence(STAGES, !isControlled || isWorking);
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const base = VARIANTS[variant] ?? VARIANTS.Steps;
  const v = {
    ...base,
    rows: rows ?? base.rows,
    active: active ?? base.active,
    done: done ?? base.done,
  };

  const working = isControlled ? isWorking : stage < 3;
  const autoExpanded = working;
  const expanded = manualExpanded ?? autoExpanded;
  const visible = isControlled
    ? v.rows.length
    : stage < 2 ? 0 : stage === 2 ? Math.min(2, v.rows.length) : v.rows.length;

  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
  }, [visible, expanded, variant, stage]);

  /* let embedders sequence content after the trace settles */
  const settledRef = useRef(false);
  useEffect(() => {
    if (working || settledRef.current) return;
    settledRef.current = true;
    onSettled?.();
  }, [working, onSettled]);

  return (
    <div
      key={variant}
      className={`flex w-full flex-col ${className || "max-w-95"}`}
      style={{
        transition: "min-height 400ms cubic-bezier(0.23,1,0.32,1)",
      }}
    >
      {/* header — shared across variants */}
      <button
        type="button"
        aria-expanded={expanded}
        disabled={v.rows.length === 0}
        onClick={() => {
          if (v.rows.length > 0) {
            setManualExpanded((current) => !(current ?? autoExpanded));
          }
        }}
        className={cn(
          "-mx-1.5 flex w-fit items-center gap-2 rounded-control px-2 py-1 transition-colors duration-100 select-none",
          v.rows.length > 0 ? "hover:bg-hover-2 cursor-pointer" : "cursor-default"
        )}
      >
        {icon ? (
          <span className="flex shrink-0 transition-colors duration-200" style={{ color: working ? "var(--ink-2)" : "var(--ink-3)" }}>
            {icon}
          </span>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill={working ? "var(--ink-2)" : "var(--ink-3)"} className="shrink-0 transition-colors">
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          </svg>
        )}
        <span role="status" className="contents">
          {working ? (
            <span
              className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
                backgroundSize: "200% 100%",
                animation: "shimmer-text 1.4s linear infinite",
              }}
            >
              {v.active}
            </span>
          ) : (
            <span
              className="text-[13px] font-medium whitespace-nowrap text-ink-2"
              style={{ animation: "fade-in 350ms ease-out both" }}
            >
              {v.done}
            </span>
          )}
        </span>
        {v.rows.length > 0 && (
          <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            className="transition-transform duration-300 ml-0.5"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {/* expandable trace */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded && v.rows.length > 0 ? "1fr" : "0fr",
          opacity: expanded && v.rows.length > 0 ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-line"
              style={{ top: -4, height: lineHeight ? Math.max(0, lineHeight - 4) : 0, transition: "height 500ms cubic-bezier(0.23,1,0.32,1)" }}
            />
            <div ref={traceRef} className="flex flex-col gap-1 py-1">
              {v.query && (
                <div className="flex h-6 items-center gap-2 px-1.5" style={{ animation: expanded ? "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" : undefined }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" className="shrink-0">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  <span className="text-[12.5px] text-ink-2">{v.query}</span>
                </div>
              )}
              {v.rows.slice(0, visible).map((row, i) => {
                const content = (
                  <>
                    {variant === "Search" && <Dot tone={TONES[i % 3]} />}
                    {variant === "Steps" && (
                      i < visible - 1 || !working ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : (
                        <span className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2 animate-spin" />
                      )
                    )}
                    <span className={`min-w-0 truncate text-[12.5px] ${variant === "Reasoning" ? "whitespace-normal leading-relaxed text-ink-2" : "font-medium text-ink"} ${variant === "Search" ? "animated-underline" : ""}`}>
                      {row.primary}
                    </span>
                    {row.secondary && (
                      <span className={`shrink-0 text-[11.5px] text-ink-3 ${row.mono ? "font-mono" : ""}`}>
                        {row.secondary}
                      </span>
                    )}
                    {row.add !== undefined && (
                      <span className="shrink-0 font-mono text-[11px] tabular-nums">
                        <span className="text-green">+{row.add}</span>{" "}
                        <span className="text-red">−{row.del}</span>
                      </span>
                    )}
                  </>
                );
                const rowClass = "flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left";
                const animation = { animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both` };

                if (variant === "Search" && row.href) {
                  return (
                    <a
                      key={row.primary}
                      href={row.href}
                      target="_blank"
                      rel="noreferrer"
                      className={`${rowClass} transition-colors duration-150 hover:bg-hover`}
                      style={animation}
                    >
                      {content}
                    </a>
                  );
                }

                if (variant === "Coding") {
                  const selected = selectedTool === row.primary;
                  return (
                    <button
                      key={row.primary}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedTool(selected ? null : row.primary)}
                      className={`${rowClass} transition-colors duration-150 ${selected ? "bg-inset" : "hover:bg-hover"}`}
                      style={animation}
                    >
                      {content}
                    </button>
                  );
                }

                return (
                  <div key={row.primary} className={rowClass} style={animation}>
                    {content}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
