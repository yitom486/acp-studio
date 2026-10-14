"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Brain,
  Check,
  ChevronDown,
  Circle,
  FileText,
  Globe2,
  ImageIcon,
  MessageSquare,
  PencilLine,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AgentDisclosure } from "@/components/primitives/AgentDisclosure";
import { ThinkingShimmer } from "@/components/primitives/TextShimmer";
import {
  EASE_OUT,
  SPRING_LAYOUT,
  SPRING_SWAP,
} from "@/lib/motion-primitives";
import { cn } from "@/lib/utils";

// ---------- Types ----------

export type AgentActivityStatus = "working" | "complete";
export type AgentStepStatus = "pending" | "active" | "complete";

export interface AgentActivityStep {
  id: string;
  type: "step";
  label: ReactNode;
  status?: AgentStepStatus;
  meta?: ReactNode;
}

export interface AgentActivityText {
  id: string;
  type: "text";
  content: ReactNode;
}

export interface AgentSearchResult {
  id: string;
  title: ReactNode;
  domain?: ReactNode;
  url?: string;
  icon?: ReactNode;
}

export interface AgentActivitySearch {
  id: string;
  type: "search";
  query: ReactNode;
  results?: AgentSearchResult[];
  moreCount?: number;
}

export interface AgentActivityTool {
  id: string;
  type: "tool";
  action: "read" | "edit" | "write" | "run" | "diff" | "delete" | (string & {});
  target: ReactNode;
  additions?: number;
  deletions?: number;
  status?: "pending" | "running" | "completed" | "error";
  raw?: any;
}

export type AgentTraceKind =
  | "thinking"
  | "message"
  | "write"
  | "run"
  | "read"
  | (string & {});

export interface AgentActivityTrace {
  id: string;
  type: "trace";
  kind: AgentTraceKind;
  label: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
}

export type AgentActivityItem =
  | AgentActivityStep
  | AgentActivityText
  | AgentActivitySearch
  | AgentActivityTool
  | AgentActivityTrace;

export type AgentActivityContentType = AgentActivityItem["type"] | "mixed";

export interface AgentActivityProps {
  items: AgentActivityItem[];
  contentType?: AgentActivityContentType;
  status?: AgentActivityStatus;
  duration?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapseOnComplete?: boolean;
  activeLabel?: ReactNode;
  summary?: ReactNode;
  renderWorkingStatus?: (context: {
    label: ReactNode;
    duration: number;
  }) => ReactNode;
  renderCompletedStatus?: (context: {
    summary: ReactNode;
    duration: number;
  }) => ReactNode;
  onItemClick?: (item: AgentActivityItem) => void;
  maxHeight?: number;
  className?: string;
  contentClassName?: string;
}

// ---------- Helper formatters ----------

function formatDuration(duration: number) {
  const seconds = Math.max(0, Math.round(duration * 10) / 10);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function getContentType(items: AgentActivityItem[]): AgentActivityContentType {
  const first = items[0]?.type;
  return first && items.every((item) => item.type === first) ? first : "mixed";
}

function getActiveLabel(type: AgentActivityContentType) {
  if (type === "search") return "正在检索工作区与网络…";
  if (type === "tool") return "正在执行工具调用…";
  if (type === "trace") return "正在分析上下文并规划步骤…";
  if (type === "mixed") return "正在规划并执行步骤…";
  return "正在深度思考…";
}

function getSummary(
  type: AgentActivityContentType,
  items: AgentActivityItem[],
  duration: number,
): ReactNode {
  const durStr = duration > 0 ? `用时 ${formatDuration(duration)}` : "";
  if (type === "step" || type === "text") {
    return (
      <>
        已完成思考 <span className="tabular-nums text-muted-foreground/75 font-mono text-xs">{durStr}</span>
      </>
    );
  }
  if (type === "search") return `完成了 ${items.length} 次检索`;
  if (type === "tool") {
    let adds = 0;
    let dels = 0;
    let hasDiff = false;
    for (const item of items) {
      if (item.type === "tool") {
        if (typeof item.additions === "number") {
          adds += item.additions;
          hasDiff = true;
        }
        if (typeof item.deletions === "number") {
          dels += item.deletions;
          hasDiff = true;
        }
      }
    }
    return (
      <span className="inline-flex items-center gap-1.5">
        <span>执行了 {items.length} 个操作</span>
        {hasDiff && (
          <span className="font-mono text-[11px] tabular-nums">
            {adds > 0 && <span className="text-emerald-500">+{adds}</span>}
            {adds > 0 && dels > 0 && <span className="text-muted-foreground/40">/</span>}
            {dels > 0 && <span className="text-rose-500">−{dels}</span>}
          </span>
        )}
        {durStr && <span className="font-mono text-xs text-muted-foreground/70">{durStr}</span>}
      </span>
    );
  }
  return `已完成 ${items.length} 个执行步骤 ${durStr ? `(${durStr})` : ""}`;
}

// ---------- Subcomponents for Row Items ----------

function ActionIcon({ action }: { action: string }) {
  const norm = action.toLowerCase();
  if (norm === "read") return <FileText className="size-3.5 text-blue-400" />;
  if (norm === "edit" || norm === "write") {
    return <PencilLine className="size-3.5 text-amber-400" />;
  }
  if (norm === "run" || norm === "terminal") {
    return <SquareTerminal className="size-3.5 text-emerald-400" />;
  }
  if (norm === "search") return <Search className="size-3.5 text-purple-400" />;
  return <Wrench className="size-3.5 text-muted-foreground" />;
}

function ToolRow({
  item,
  onClick,
}: {
  item: AgentActivityTool;
  onClick?: () => void;
}) {
  const actionText =
    item.action === "read"
      ? "读取"
      : item.action === "edit"
        ? "编辑"
        : item.action === "run"
          ? "执行"
          : item.action;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group flex min-h-7 min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-xs leading-5 bg-card/60 hover:bg-card border border-border/50 transition-colors",
        onClick && "cursor-pointer",
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-4 shrink-0 place-items-center"
      >
        <ActionIcon action={item.action} />
      </span>
      <span className="shrink-0 font-medium text-foreground/90">{actionText}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
        {item.target}
      </span>
      {(typeof item.additions === "number" || typeof item.deletions === "number") && (
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
          {typeof item.additions === "number" && item.additions > 0 && (
            <span className="text-emerald-500 font-medium">+{item.additions}</span>
          )}
          {typeof item.deletions === "number" && item.deletions > 0 && (
            <span className="text-rose-500 font-medium">−{item.deletions}</span>
          )}
        </span>
      )}
    </div>
  );
}

function StepRow({ item }: { item: AgentActivityStep }) {
  const state = item.status ?? "complete";

  return (
    <div className="flex min-h-6 items-start gap-2.5 rounded-md px-1.5 py-0.5 text-xs">
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-3.5 shrink-0 place-items-center text-muted-foreground/70"
      >
        {state === "complete" ? (
          <Check className="size-3.5 text-emerald-500" strokeWidth={2} />
        ) : state === "active" ? (
          <span className="relative grid size-3 place-items-center">
            <motion.span
              className="absolute inset-0 rounded-full bg-primary/20"
              animate={{ opacity: [0.35, 0.8, 0.35] }}
              transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
            />
            <span className="size-1.5 rounded-full bg-primary" />
          </span>
        ) : (
          <Circle className="size-3 text-muted-foreground/40" strokeWidth={1.5} />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 leading-5",
          state === "pending" ? "text-muted-foreground/55" : "text-foreground/90",
        )}
      >
        {item.label}
      </span>
      {item.meta && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
          {item.meta}
        </span>
      )}
    </div>
  );
}

function TextRow({ item }: { item: AgentActivityText }) {
  return (
    <div className="rounded-md px-2 py-1 leading-relaxed text-xs text-muted-foreground bg-muted/40 font-mono whitespace-pre-wrap line-clamp-3">
      {item.content}
    </div>
  );
}

function SearchRow({ item }: { item: AgentActivitySearch }) {
  return (
    <div className="space-y-1 rounded-lg border border-border/50 bg-card/50 p-2 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Search className="size-3.5 shrink-0 text-primary" strokeWidth={1.8} />
        <span className="min-w-0 truncate font-medium text-foreground">{item.query}</span>
      </div>
      {item.results && item.results.length > 0 && (
        <div className="space-y-0.5 pl-4 pt-1">
          {item.results.map((res) => (
            <div key={res.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Globe2 className="size-3 shrink-0" />
              <span className="truncate flex-1">{res.title}</span>
              {res.domain && <span className="text-[10px] font-mono text-muted-foreground/60">{res.domain}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TraceRow({ item }: { item: AgentActivityTrace }) {
  return (
    <div className="flex min-h-6 items-center gap-2 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground">
      <Sparkles className="size-3.5 text-primary shrink-0" />
      <span className="font-medium text-foreground/90">{item.label}</span>
      {item.detail && (
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/70">
          {item.detail}
        </span>
      )}
    </div>
  );
}

export function ActivityRow({
  item,
  onClick,
}: {
  item: AgentActivityItem;
  onClick?: () => void;
}) {
  if (item.type === "text") return <TextRow item={item} />;
  if (item.type === "search") return <SearchRow item={item} />;
  if (item.type === "tool") return <ToolRow item={item} onClick={onClick} />;
  if (item.type === "trace") return <TraceRow item={item} />;
  return <StepRow item={item} />;
}

// ---------- Main AgentActivity Component ----------

export function AgentActivity({
  items,
  contentType: initialContentType,
  status = "working",
  duration = 0,
  open,
  defaultOpen = false,
  onOpenChange,
  collapseOnComplete = true,
  activeLabel,
  summary,
  renderWorkingStatus,
  renderCompletedStatus,
  onItemClick,
  maxHeight = 240,
  className,
  contentClassName,
}: AgentActivityProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const contentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousStatus = useRef(status);
  const [contentHeight, setContentHeight] = useState(0);

  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = open !== undefined;
  const currentOpen = open ?? internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const working = status === "working";
  const expanded = working || currentOpen;
  const contentType = items.length
    ? getContentType(items)
    : (initialContentType ?? "mixed");

  const cappedHeight = Math.min(contentHeight, Math.max(0, maxHeight));
  const viewportHeight = working ? Math.max(0, maxHeight) : cappedHeight;
  const capped = contentHeight > maxHeight;
  const streamOffset = working
    ? Math.min(0, viewportHeight - contentHeight)
    : 0;

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const measure = () => setContentHeight(node.offsetHeight);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (previousStatus.current === "working" && status === "complete") {
      setOpen(!collapseOnComplete);
    }
    previousStatus.current = status;
  }, [collapseOnComplete, setOpen, status]);

  const toggle = () => {
    const next = !currentOpen;
    setOpen(next);
    if (next) {
      requestAnimationFrame(() => viewportRef.current?.scrollTo({ top: 0 }));
    }
  };

  const liveLabel = activeLabel ?? getActiveLabel(contentType);
  const completedSummary = summary ?? getSummary(contentType, items, duration);

  const maskImage = capped
    ? working
      ? "linear-gradient(to bottom, transparent, black 16px)"
      : "linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent)"
    : undefined;

  return (
    <div
      data-slot="agent-activity"
      data-state={working ? "working" : expanded ? "open" : "closed"}
      data-content={contentType}
      aria-busy={working}
      className={cn("w-full text-sm", className)}
    >
      {working ? (
        <div
          id={triggerId}
          role="status"
          className="flex h-7 min-w-0 items-center gap-2 text-muted-foreground select-none"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          {renderWorkingStatus ? (
            renderWorkingStatus({ label: liveLabel, duration })
          ) : (
            <ThinkingShimmer duration={1.8}>{liveLabel}</ThinkingShimmer>
          )}
          {duration > 0 && (
            <span className="text-[11px] font-mono tabular-nums text-muted-foreground/60 ml-auto">
              {formatDuration(duration)}
            </span>
          )}
        </div>
      ) : (
        <button
          id={triggerId}
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={toggle}
          className="group flex h-7 min-w-0 items-center gap-1.5 rounded-md text-left font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate text-xs">
            {renderCompletedStatus
              ? renderCompletedStatus({ summary: completedSummary, duration })
              : completedSummary}
          </span>
          <motion.span
            aria-hidden="true"
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="inline-flex shrink-0 text-muted-foreground/70 group-hover:text-foreground"
          >
            <ChevronDown className="size-3.5" />
          </motion.span>
        </button>
      )}

      <AgentDisclosure
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        open={expanded}
        openHeight={viewportHeight > 0 ? viewportHeight : "auto"}
      >
        <div
          ref={viewportRef}
          className={cn(
            "pr-1",
            capped && expanded && !working ? "overflow-y-auto" : "overflow-y-hidden",
          )}
          style={{
            height: viewportHeight > 0 ? viewportHeight : undefined,
            maskImage,
            WebkitMaskImage: maskImage,
          }}
        >
          <motion.div
            ref={contentRef}
            role="list"
            initial={false}
            animate={{ y: streamOffset }}
            transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
            className={cn("space-y-1 py-1.5", contentClassName)}
          >
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <motion.div
                  layout="position"
                  key={item.id}
                  role="listitem"
                  initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : {
                          opacity: { duration: 0.18, ease: EASE_OUT },
                          y: SPRING_LAYOUT,
                          layout: SPRING_LAYOUT,
                        }
                  }
                >
                  <ActivityRow item={item} onClick={() => onItemClick?.(item)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      </AgentDisclosure>
    </div>
  );
}
