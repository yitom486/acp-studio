"use client";

import React, { useState, useCallback } from "react";
import { FileCode2, ChevronDown, LoaderCircle, Sparkles, History, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { FileDiff, parseUnifiedDiff, type FileDiffLine } from "@/components/primitives/FileDiff";
import { gitFile } from "@/lib/universal-api";
import { SPRING_PRESS, SPRING_SWAP } from "@/lib/motion-primitives";
import { cn } from "@/lib/utils";

export interface TurnDiffViewerProps {
  files: string[];
  cwd?: string | null;
  className?: string;
  onOpenChangesModal?: () => void;
}

interface FileDiffState {
  lines: FileDiffLine[];
  loading: boolean;
  error?: string;
}

/** Helper to format file path relative to cwd if possible */
function formatFilePath(file: string, cwd?: string | null): { name: string; relPath: string; ext: string } {
  let rel = file;
  if (cwd && file.startsWith(cwd)) {
    rel = file.slice(cwd.length).replace(/^[/\\]/, "");
  }
  rel = rel.replace(/\\/g, "/");
  const parts = rel.split("/");
  const name = parts[parts.length - 1] || rel;
  const extMatch = name.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : "";
  return { name, relPath: rel, ext };
}

/** Get badge color based on file extension */
function getExtColor(ext: string): string {
  switch (ext) {
    case "ts":
    case "tsx":
      return "text-sky-500 bg-sky-500/10 border-sky-500/20";
    case "js":
    case "jsx":
      return "text-amber-500 bg-amber-500/10 border-amber-500/20";
    case "css":
    case "scss":
      return "text-pink-500 bg-pink-500/10 border-pink-500/20";
    case "json":
      return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
    case "py":
      return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
    case "md":
      return "text-blue-500 bg-blue-500/10 border-blue-500/20";
    default:
      return "text-muted-foreground bg-muted/40 border-border/60";
  }
}

/**
 * Fallback line differ if git unified diff is empty (e.g. untracked new file)
 */
function createLinesFromText(before: string, after: string): FileDiffLine[] {
  const oldLines = before ? before.replace(/\r\n/g, "\n").split("\n") : [];
  const newLines = after ? after.replace(/\r\n/g, "\n").split("\n") : [];

  if (oldLines.length === 0) {
    // Brand new file: all added
    return newLines.map((content, idx) => ({
      id: `add-${idx}`,
      type: "added",
      newLine: idx + 1,
      content,
    }));
  }

  // Simple diff mapping
  const lines: FileDiffLine[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      lines.push({
        id: `ctx-${i}`,
        type: "context",
        oldLine: i + 1,
        newLine: i + 1,
        content: n ?? o ?? "",
      });
    } else {
      if (o !== undefined) {
        lines.push({
          id: `del-${i}`,
          type: "removed",
          oldLine: i + 1,
          content: o,
        });
      }
      if (n !== undefined) {
        lines.push({
          id: `add-${i}`,
          type: "added",
          newLine: i + 1,
          content: n,
        });
      }
    }
  }
  return lines;
}

export const TurnDiffViewer: React.FC<TurnDiffViewerProps> = ({
  files,
  cwd,
  className,
  onOpenChangesModal,
}) => {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, FileDiffState>>({});

  const loadFileDiff = useCallback(
    async (file: string) => {
      if (cache[file] && !cache[file].loading) {
        return;
      }

      setCache((prev) => ({
        ...prev,
        [file]: { lines: [], loading: true },
      }));

      try {
        if (!cwd) {
          throw new Error("无可用工作区路径");
        }
        const res = await gitFile(cwd, file);
        let parsedLines: FileDiffLine[] = [];

        if (res.unified) {
          const parsed = parseUnifiedDiff(res.unified);
          parsedLines = parsed.lines;
        } else if (res.after != null || res.before != null) {
          parsedLines = createLinesFromText(res.before ?? "", res.after ?? "");
        }

        setCache((prev) => ({
          ...prev,
          [file]: { lines: parsedLines, loading: false },
        }));
      } catch (err) {
        setCache((prev) => ({
          ...prev,
          [file]: {
            lines: [],
            loading: false,
            error: (err as Error).message || "获取 Diff 失败",
          },
        }));
      }
    },
    [cache, cwd],
  );

  const toggleFile = (file: string) => {
    if (expandedFile === file) {
      setExpandedFile(null);
    } else {
      setExpandedFile(file);
      void loadFileDiff(file);
    }
  };

  if (!files || files.length === 0) return null;

  return (
    <div
      data-slot="turn-diff-viewer"
      className={cn(
        "rounded-xl border border-border/70 bg-card/60 p-2.5 space-y-2 select-none text-xs",
        className,
      )}
    >
      {/* Summary Header */}
      <div className="flex items-center justify-between text-muted-foreground gap-2">
        <div className="flex items-center gap-1.5 font-medium text-foreground text-[11px]">
          <Sparkles className="size-3.5 text-primary" />
          <span>本轮改动了 {files.length} 个文件</span>
        </div>
        <div className="flex items-center gap-2">
          {onOpenChangesModal && (
            <button
              type="button"
              onClick={onOpenChangesModal}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
              title="打开版本改动审查面板"
            >
              <History className="size-3" />
              <span>版本审查</span>
            </button>
          )}
          <span className="text-[10px] font-mono text-muted-foreground/70 hidden sm:inline">
            点击文件展开代码 Diff
          </span>
        </div>
      </div>

      {/* File Pills List */}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {files.map((file) => {
          const isSelected = expandedFile === file;
          const { name, relPath, ext } = formatFilePath(file, cwd);
          const extCls = getExtColor(ext);
          const diffData = cache[file];

          return (
            <motion.button
              key={file}
              type="button"
              onClick={() => toggleFile(file)}
              whileTap={{ scale: 0.97 }}
              transition={SPRING_PRESS}
              title={relPath}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors outline-none",
                isSelected
                  ? "border-primary/50 bg-primary/10 text-primary font-medium shadow-xs"
                  : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <FileCode2 className="size-3.5 shrink-0" />
              <span className="truncate max-w-[200px]">{name}</span>
              {ext && (
                <span className={cn("text-[9px] px-1 py-0.2 rounded border font-sans", extCls)}>
                  {ext}
                </span>
              )}
              {diffData?.loading ? (
                <LoaderCircle className="size-3 animate-spin text-primary ml-0.5" />
              ) : (
                <motion.span
                  animate={{ rotate: isSelected ? 180 : 0 }}
                  transition={SPRING_SWAP}
                  className="ml-0.5"
                >
                  <ChevronDown className="size-3 opacity-60" />
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Expanded FileDiff view */}
      <AnimatePresence mode="wait">
        {expandedFile && (
          <motion.div
            key={expandedFile}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="pt-1"
          >
            {cache[expandedFile]?.loading ? (
              <div className="flex items-center justify-center p-6 text-xs text-muted-foreground gap-2 rounded-lg border border-border/50 bg-background/50">
                <LoaderCircle className="size-4 animate-spin text-primary" />
                <span>正在加载 {formatFilePath(expandedFile, cwd).name} 的代码差异…</span>
              </div>
            ) : cache[expandedFile]?.error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {cache[expandedFile]?.error}
              </div>
            ) : cache[expandedFile]?.lines && cache[expandedFile]?.lines.length > 0 ? (
              <FileDiff
                file={formatFilePath(expandedFile, cwd).relPath}
                lines={cache[expandedFile]?.lines || []}
                status="complete"
                defaultOpen={true}
                maxHeight={280}
              />
            ) : (
              <div className="flex items-center justify-center p-4 text-xs text-muted-foreground gap-2 rounded-lg border border-border/50 bg-background/50">
                <Check className="size-3.5 text-success" />
                <span>该文件无未暂存的代码改动（或改动已提交）</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
