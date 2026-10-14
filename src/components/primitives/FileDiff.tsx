"use client";

import {
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  LoaderCircle,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AgentDisclosure } from "@/components/primitives/AgentDisclosure";
import { SPRING_PRESS, SPRING_SWAP } from "@/lib/motion-primitives";
import { cn } from "@/lib/utils";

export type FileDiffStatus = "streaming" | "complete";
export type FileDiffLineType = "added" | "removed" | "context";

export interface FileDiffLine {
  id: string;
  type?: FileDiffLineType;
  oldLine?: number;
  newLine?: number;
  content: string;
}

export interface FileDiffProps {
  file: ReactNode;
  lines: FileDiffLine[];
  status?: FileDiffStatus;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapseOnComplete?: boolean;
  maxHeight?: number;
  language?: string;
  copyText?: string;
  onCopy?: () => void | Promise<void>;
  className?: string;
}

function ChangeCount({
  value,
  type,
}: {
  value: number;
  type: "added" | "removed";
}) {
  if (!value) return null;
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums font-semibold",
        type === "added"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-rose-600 dark:text-rose-400",
      )}
    >
      {type === "added" ? "+" : "−"}
      {value}
    </span>
  );
}

/**
 * Lightweight syntax tokenizer for code diff lines.
 * Highlights keywords, strings, comments, numbers, and types with zero heavy bundle overhead.
 */
function highlightCodeLine(code: string, language = "typescript"): ReactNode {
  if (!code) return " ";

  // Comment check
  if (/^\s*(\/\/|#|\/\*|\*)/.test(code)) {
    return <span className="text-muted-foreground/60 italic">{code}</span>;
  }

  const tokenRegex =
    /(".*?"|'.*?'|`.*?`|\b(?:const|let|var|function|return|import|export|from|if|else|for|while|class|interface|type|extends|implements|new|async|await|try|catch|finally|throw|default|switch|case|break|continue|null|undefined|true|false|public|private|protected|readonly|def|self|None|True|False)\b|\b\d+(?:\.\d+)?\b|[{}()[\].,;:+\-*/%=<>!&|^~?]+|[a-zA-Z_$][a-zA-Z0-9_$]*)/g;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      parts.push(code.slice(lastIndex, match.index));
    }

    const val = match[0];
    if (/^["'`]/.test(val)) {
      parts.push(
        <span key={match.index} className="text-emerald-500 dark:text-emerald-400">
          {val}
        </span>,
      );
    } else if (
      /^(?:const|let|var|function|return|import|export|from|if|else|for|while|class|interface|type|extends|implements|new|async|await|try|catch|finally|throw|default|switch|case|break|continue|null|undefined|true|false|public|private|protected|readonly|def|self|None|True|False)$/.test(
        val,
      )
    ) {
      parts.push(
        <span key={match.index} className="text-sky-500 dark:text-sky-400 font-medium">
          {val}
        </span>,
      );
    } else if (/^\d+(?:\.\d+)?$/.test(val)) {
      parts.push(
        <span key={match.index} className="text-amber-500 dark:text-amber-400">
          {val}
        </span>,
      );
    } else if (/^[A-Z][a-zA-Z0-9_$]*$/.test(val)) {
      parts.push(
        <span key={match.index} className="text-violet-500 dark:text-violet-400">
          {val}
        </span>,
      );
    } else {
      parts.push(val);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < code.length) {
    parts.push(code.slice(lastIndex));
  }

  return parts;
}

export function FileDiff({
  file,
  lines,
  status = "streaming",
  open,
  defaultOpen = true,
  onOpenChange,
  collapseOnComplete = false,
  maxHeight = 280,
  language = "typescript",
  copyText,
  onCopy,
  className,
}: FileDiffProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousStatus = useRef(status);
  const copyTimer = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const streaming = status === "streaming";
  const additions = lines.filter((line) => line.type === "added").length;
  const deletions = lines.filter((line) => line.type === "removed").length;
  const canCopy = Boolean(copyText || onCopy);

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  useEffect(() => {
    if (previousStatus.current !== "streaming" && status === "streaming") {
      setOpen(true);
    }
    if (
      previousStatus.current === "streaming" &&
      status === "complete" &&
      collapseOnComplete
    ) {
      setOpen(false);
    }
    previousStatus.current = status;
  }, [collapseOnComplete, setOpen, status]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !currentOpen || !streaming) return;

    const frame = requestAnimationFrame(() => {
      if (viewport.scrollHeight <= viewport.clientHeight) return;
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: reduce ? "auto" : "smooth",
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  const handleCopy = useCallback(async () => {
    if (onCopy) await onCopy();
    else if (copyText) await navigator.clipboard?.writeText(copyText);
    else {
      const fullText = lines
        .map((l) => `${l.type === "added" ? "+" : l.type === "removed" ? "-" : " "} ${l.content}`)
        .join("\n");
      await navigator.clipboard?.writeText(fullText);
    }

    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [copyText, lines, onCopy]);

  return (
    <div
      data-slot="file-diff"
      data-state={status}
      aria-busy={streaming}
      className={cn("w-full text-sm", className)}
    >
      <button
        id={triggerId}
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring"
      >
        <FileCode2
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90 font-medium">
          {file}
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono">
          <ChangeCount value={additions} type="added" />
          <ChangeCount value={deletions} type="removed" />
        </span>
        <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/60">
          {streaming ? (
            <LoaderCircle
              aria-label="Applying changes"
              className={cn("size-3.5 text-primary", !reduce && "animate-spin")}
            />
          ) : (
            <Check aria-label="Changes applied" className="size-3.5 text-emerald-500" />
          )}
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="shrink-0 text-muted-foreground/45 transition-colors group-hover:text-muted-foreground"
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

      <AgentDisclosure
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        open={currentOpen}
      >
        <div className="pt-1.5 pb-2">
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card/70 shadow-xs">
            <div
              ref={viewportRef}
              data-slot="file-diff-viewport"
              aria-live="polite"
              className="overflow-auto scrollbar-thin"
              style={{ maxHeight }}
            >
              <div className="font-mono text-xs leading-5">
                <span className="sr-only">File changes</span>
                {lines.map((line) => {
                  const type = line.type ?? "context";
                  return (
                    <div
                      key={line.id}
                      className={cn(
                        "grid grid-cols-[2.25rem_2.25rem_1rem_minmax(0,1fr)] hover:bg-accent/30 transition-colors",
                        type === "added" && "bg-emerald-500/10 dark:bg-emerald-500/[0.08]",
                        type === "removed" && "bg-rose-500/10 dark:bg-rose-500/[0.08]",
                      )}
                    >
                      <span className="select-none pr-2 text-right tabular-nums text-muted-foreground/40 text-[11px]">
                        {line.oldLine ?? ""}
                      </span>
                      <span className="select-none pr-2 text-right tabular-nums text-muted-foreground/40 text-[11px]">
                        {line.newLine ?? ""}
                      </span>
                      <span
                        className={cn(
                          "select-none text-center font-bold text-muted-foreground/45",
                          type === "added" && "text-emerald-600 dark:text-emerald-400",
                          type === "removed" && "text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {type === "added"
                          ? "+"
                          : type === "removed"
                          ? "−"
                          : ""}
                      </span>
                      <div className="min-w-0 whitespace-pre px-1.5 overflow-x-auto text-foreground/90 font-mono">
                        {highlightCodeLine(line.content, language)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/40 px-3 py-1 bg-muted/20 text-[11px] text-muted-foreground">
              <span>{lines.length} 行对比内容</span>
              <motion.button
                type="button"
                aria-label={copied ? "已复制" : "复制代码改动"}
                title={copied ? "已复制" : "复制代码改动"}
                onClick={handleCopy}
                whileTap={reduce ? undefined : { scale: 0.9 }}
                transition={SPRING_PRESS}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                {copied ? (
                  <>
                    <Check className="size-3 text-emerald-500" />
                    <span className="text-[10px] text-emerald-500">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    <span className="text-[10px]">复制</span>
                  </>
                )}
              </motion.button>
            </div>
          </div>
        </div>
      </AgentDisclosure>
    </div>
  );
}

/**
 * Utility parser for standard unified git diff patches (e.g. @@ -1,5 +1,6 @@)
 */
export function parseUnifiedDiff(diffText: string): {
  file: string;
  lines: FileDiffLine[];
} {
  const rawLines = diffText.split("\n");
  let file = "diff";
  const lines: FileDiffLine[] = [];
  let oldLineCounter = 1;
  let newLineCounter = 1;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      const match = raw.match(/[ab]\/(.*)$/);
      if (match) file = match[1];
      continue;
    }
    if (raw.startsWith("@@")) {
      const hunk = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        oldLineCounter = parseInt(hunk[1], 10);
        newLineCounter = parseInt(hunk[2], 10);
      }
      continue;
    }

    if (raw.startsWith("+")) {
      lines.push({
        id: `line-${i}`,
        type: "added",
        newLine: newLineCounter++,
        content: raw.slice(1),
      });
    } else if (raw.startsWith("-")) {
      lines.push({
        id: `line-${i}`,
        type: "removed",
        oldLine: oldLineCounter++,
        content: raw.slice(1),
      });
    } else {
      lines.push({
        id: `line-${i}`,
        type: "context",
        oldLine: oldLineCounter++,
        newLine: newLineCounter++,
        content: raw.startsWith(" ") ? raw.slice(1) : raw,
      });
    }
  }

  return { file, lines };
}
