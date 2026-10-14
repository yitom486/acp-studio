"use client";

import {
  type ReactNode,
  useCallback,
  useId,
  useState,
} from "react";
import { BookOpenText, ChevronDown, ExternalLink, Globe2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AgentDisclosure } from "@/components/primitives/AgentDisclosure";
import { EASE_OUT, SPRING_LAYOUT, SPRING_SWAP } from "@/lib/motion-primitives";
import { useFavicon } from "@/hooks/useFavicon";
import { cn } from "@/lib/utils";

export interface CitationItem {
  id: string;
  title: ReactNode;
  domain?: ReactNode;
  url?: string;
  /** Custom icon to draw instead of the favicon */
  icon?: ReactNode;
}

export interface CitationsProps {
  citations: CitationItem[];
  title?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  idPrefix?: string;
  className?: string;
}

export interface CitationProps {
  citationId: string;
  index: number;
  idPrefix: string;
  label?: string;
  className?: string;
}

export interface CitationListProps {
  citations: CitationItem[];
  idPrefix?: string;
  className?: string;
}

export interface CitationStackProps {
  citations: CitationItem[];
  limit?: number;
  className?: string;
}

function citationTargetId(prefix: string, citationId: string) {
  return `${prefix}-${citationId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** Inline citation superscript badge [1] */
export function Citation({
  citationId,
  index,
  idPrefix,
  label,
  className,
}: CitationProps) {
  return (
    <a
      href={`#${citationTargetId(idPrefix, citationId)}`}
      aria-label={label ?? `查看引用源 ${index}`}
      data-slot="citation-badge"
      className={cn(
        "mx-0.5 inline-flex min-w-4 -translate-y-0.5 items-center justify-center rounded-md bg-muted/70 px-1 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground no-underline outline-none transition-colors hover:text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {index}
    </a>
  );
}

export function CitationFavicon({
  url,
  icon,
  className,
}: {
  url?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const favicon = useFavicon(icon ? undefined : url);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-5 shrink-0 place-items-center text-muted-foreground [&>svg]:size-3.5",
        className,
      )}
    >
      {icon ? (
        icon
      ) : favicon.src ? (
        <img
          ref={favicon.ref}
          src={favicon.src}
          alt=""
          width={16}
          height={16}
          referrerPolicy="no-referrer"
          className="size-4 rounded-xs object-contain"
        />
      ) : (
        <Globe2 className="size-3.5" />
      )}
    </span>
  );
}

export function CitationStack({
  citations,
  limit = 3,
  className,
}: CitationStackProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex -space-x-1.5", className)}
    >
      {citations.slice(0, limit).map((citation) => (
        <CitationFavicon
          key={citation.id}
          url={citation.url}
          icon={citation.icon}
          className="size-5 rounded-full bg-background ring-1 ring-border"
        />
      ))}
    </span>
  );
}

function CitationRow({
  citation,
  index,
  idPrefix,
}: {
  citation: CitationItem;
  index: number;
  idPrefix: string;
}) {
  const content = (
    <>
      <CitationFavicon url={citation.url} icon={citation.icon} />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="truncate text-xs font-medium text-foreground/85 transition-colors group-hover/citation:text-foreground">
          {citation.title}
        </span>
        {citation.domain ? (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground/60 font-mono">
            {citation.domain}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="grid size-4 place-items-center rounded-md bg-foreground/[0.05] text-[10px] font-semibold tabular-nums text-muted-foreground">
          {index}
        </span>
        {citation.url ? (
          <ExternalLink className="size-3 text-muted-foreground/40 transition-colors group-hover/citation:text-muted-foreground" />
        ) : null}
      </span>
    </>
  );

  const className =
    "group/citation flex items-center gap-2 rounded-lg px-2 py-1.5 outline-none hover:bg-muted/50 border border-border/40 transition-colors focus-visible:ring-2 focus-visible:ring-ring";
  const id = citationTargetId(idPrefix, citation.id);

  return citation.url ? (
    <a
      id={id}
      href={citation.url}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
    >
      {content}
    </a>
  ) : (
    <div id={id} className={className}>
      {content}
    </div>
  );
}

export function CitationList({
  citations,
  idPrefix,
  className,
}: CitationListProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const resolvedPrefix =
    idPrefix ?? `citation-list-${baseId.replace(/:/g, "")}`;

  return (
    <div data-slot="citation-list" className={cn("grid gap-1", className)}>
      <AnimatePresence mode="popLayout">
        {citations.map((citation, index) => (
          <motion.div
            layout="position"
            key={citation.id}
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
            <CitationRow
              citation={citation}
              index={index + 1}
              idPrefix={resolvedPrefix}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Citations({
  citations,
  title = "引用来源",
  open,
  defaultOpen = false,
  onOpenChange,
  idPrefix,
  className,
}: CitationsProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const contentId = `${baseId}-content`;
  const resolvedPrefix =
    idPrefix ?? `citation-${baseId.replace(/:/g, "")}`;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  if (!citations || citations.length === 0) return null;

  return (
    <div data-slot="citations" className={cn("w-full text-xs pt-2", className)}>
      <button
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group flex min-h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpenText className="size-3.5" />
        <span className="font-medium">{title}</span>
        <span className="rounded-full bg-muted/80 border border-border/60 px-1.5 py-0.2 text-[10px] font-semibold tabular-nums text-foreground/80">
          {citations.length}
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="text-muted-foreground/60 group-hover:text-foreground"
        >
          <ChevronDown className="size-3" />
        </motion.span>
      </button>

      <AgentDisclosure id={contentId} open={currentOpen}>
        <CitationList
          citations={citations}
          idPrefix={resolvedPrefix}
          className="mt-1.5"
        />
      </AgentDisclosure>
    </div>
  );
}
