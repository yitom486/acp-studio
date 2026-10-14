import React, { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileDiff as FileDiffIcon,
  History,
  Undo2,
  X,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import { gitRestore, gitFile } from "@/lib/universal-api";
import { useGitStatusQuery, invalidateGit } from "@/lib/acp-queries";
import { useStudioStore } from "@/stores/useStudioStore";
import { FileDiff, parseUnifiedDiff, type FileDiffLine } from "@/components/primitives/FileDiff";

export interface TurnChangesProps {
  open: boolean;
  onClose: () => void;
  cwd: string | null;
  files: string[];
}

function statusText(status: string): string {
  if (status === "M") return "修改";
  if (status === "A") return "新增";
  if (status === "D") return "删除";
  if (status === "R") return "改名";
  if (status === "?") return "未跟踪";
  return status;
}

function createLinesFromText(before: string, after: string): FileDiffLine[] {
  const oldLines = before ? before.replace(/\r\n/g, "\n").split("\n") : [];
  const newLines = after ? after.replace(/\r\n/g, "\n").split("\n") : [];

  if (oldLines.length === 0) {
    return newLines.map((content, idx) => ({
      id: `add-${idx}`,
      type: "added",
      newLine: idx + 1,
      content,
    }));
  }

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

/**
 * 本轮改动文件清单 + 逐文件预览 Diff + 还原（turn-scoped undo）。
 */
export const TurnChanges: React.FC<TurnChangesProps> = (props) => {
  if (!props.open) return null;
  return <TurnChangesBody {...props} />;
};

const TurnChangesBody: React.FC<TurnChangesProps> = ({ open, onClose, cwd, files }) => {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [diffCache, setDiffCache] = useState<Record<string, { lines: FileDiffLine[]; loading: boolean; error?: string }>>({});

  const statusQuery = useGitStatusQuery(cwd, open);
  const byPath = new Map((statusQuery.data?.files || []).map((f) => [f.path, f.status]));

  const restoreMutation = useMutation({
    mutationFn: (file: string) => gitRestore(cwd as string, file),
    onSuccess: (_r, file) => {
      setMsg(`已还原 ${file}`);
      invalidateGit(qc);
    },
    onError: (err: any) => setMsg(`还原失败: ${err.message}`),
  });

  const canRestore = !!cwd && !statusQuery.isError;
  const restoringFile = restoreMutation.isPending ? (restoreMutation.variables as string) : null;

  const handleRestore = (file: string) => {
    if (!cwd || restoreMutation.isPending) return;
    if (!confirm(`确定放弃 ${file} 的当前修改吗？将恢复到 git HEAD 状态，未提交的内容会丢失。`)) return;
    setMsg(null);
    restoreMutation.mutate(file);
  };

  const handleOpenGlobalDiff = (file: string) => {
    onClose();
    useStudioStore.getState().setGitChangesOpen(true, file);
  };

  const loadInlineDiff = useCallback(async (file: string) => {
    if (diffCache[file] && !diffCache[file].loading) return;
    setDiffCache((prev) => ({ ...prev, [file]: { lines: [], loading: true } }));
    try {
      if (!cwd) throw new Error("无可用工作区路径");
      const res = await gitFile(cwd, file);
      let lines: FileDiffLine[] = [];
      if (res.unified) {
        lines = parseUnifiedDiff(res.unified).lines;
      } else if (res.before != null || res.after != null) {
        lines = createLinesFromText(res.before ?? "", res.after ?? "");
      }
      setDiffCache((prev) => ({ ...prev, [file]: { lines, loading: false } }));
    } catch (err) {
      setDiffCache((prev) => ({
        ...prev,
        [file]: { lines: [], loading: false, error: (err as Error).message || "获取 Diff 失败" },
      }));
    }
  }, [cwd, diffCache]);

  const toggleExpand = (file: string) => {
    if (expandedFile === file) {
      setExpandedFile(null);
    } else {
      setExpandedFile(file);
      void loadInlineDiff(file);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-border bg-card p-4 text-foreground text-xs space-y-3 max-h-[85vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border pb-2.5">
          <History className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm">本轮改动 · {files.length} 个文件</h2>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!cwd && <div className="text-muted-foreground">无工作区上下文，无法定位改动文件。</div>}
        {statusQuery.isFetching && files.length === 0 && (
          <div className="text-muted-foreground animate-pulse">正在读取变更状态…</div>
        )}
        {statusQuery.error && (
          <div className="p-2 rounded-lg bg-background border border-border text-muted-foreground">
            读取 git 状态失败（该工作区可能不是 git 仓库），仅展示文件清单，不提供还原。
          </div>
        )}
        {msg && <div className="p-2 rounded-lg bg-background border border-border text-muted-foreground">{msg}</div>}

        <div className="space-y-2">
          {files.map((f) => {
            const st = byPath.get(f);
            const isExpanded = expandedFile === f;
            const diffState = diffCache[f];

            return (
              <div key={f} className="rounded-xl border border-border bg-background/60 overflow-hidden transition-all">
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => toggleExpand(f)}
                >
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    title={isExpanded ? "收起代码差异" : "展开代码差异"}
                  >
                    {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </button>
                  <span className="font-mono truncate flex-1 text-[11px]" title={f}>
                    {f}
                  </span>
                  {st && (
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0 px-1.5 py-0.5 rounded bg-muted/50" title="当前 git 状态">
                      {statusText(st)}
                    </span>
                  )}
                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(f)}
                      title="在当前弹窗内查看 Diff"
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary text-[10px] transition-colors"
                    >
                      <FileDiffIcon className="w-3 h-3" />
                      <span>{isExpanded ? "收起" : "Diff"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenGlobalDiff(f)}
                      title="在 Git 审查工作区中全屏查看"
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted text-[10px] transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>审查</span>
                    </button>
                    {canRestore && (
                      <button
                        type="button"
                        onClick={() => handleRestore(f)}
                        disabled={restoringFile === f}
                        title={st ? "git restore 到 HEAD（会丢弃未提交修改）" : "git 中无此文件记录，仍可尝试还原"}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-[10px] transition-colors disabled:opacity-40"
                      >
                        <Undo2 className="w-3 h-3" />
                        <span>{restoringFile === f ? "还原中…" : "还原"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline Diff expansion */}
                {isExpanded && (
                  <div className="border-t border-border/70 p-2.5 bg-card/40">
                    {diffState?.loading ? (
                      <div className="flex items-center justify-center p-4 text-xs text-muted-foreground gap-2">
                        <LoaderCircle className="size-3.5 animate-spin text-primary" />
                        <span>正在计算差异…</span>
                      </div>
                    ) : diffState?.error ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                        {diffState.error}
                      </div>
                    ) : diffState?.lines ? (
                      <FileDiff
                        file={f}
                        lines={diffState.lines}
                        status="complete"
                        defaultOpen={true}
                        maxHeight={260}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
