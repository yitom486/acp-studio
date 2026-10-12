import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileDiff, History, Undo2, X } from "lucide-react";
import { gitRestore } from "@/lib/universal-api";
import { useGitStatusQuery, invalidateGit } from "@/lib/acp-queries";
import { useStudioStore } from "@/stores/useStudioStore";

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

/**
 * 本轮改动文件清单 + 逐文件还原（turn-scoped undo）。
 * 安全模型：只列出本轮工具实际碰过的文件；还原走 git restore 且每次都要
 * confirm；非 git 工作区只读展示、不给还原按钮（无安全网不删东西）。
 */
export const TurnChanges: React.FC<TurnChangesProps> = (props) => {
  // Hooks live in the body so a closed modal costs zero subscriptions
  // (and never requires a QueryClientProvider when shut).
  if (!props.open) return null;
  return <TurnChangesBody {...props} />;
};

const TurnChangesBody: React.FC<TurnChangesProps> = ({ open, onClose, cwd, files }) => {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
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

  const handleOpenDiff = (file: string) => {
    onClose();
    useStudioStore.getState().setGitChangesOpen(true, file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-4 text-foreground text-xs space-y-2 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <History className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm">本轮改动 · {files.length} 个文件</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
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

        <div className="space-y-1.5">
          {files.map((f) => {
            const st = byPath.get(f);
            return (
              <div key={f} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border bg-background/60">
                <span className="font-mono truncate flex-1 text-[11px]" title={f}>{f}</span>
                {st && (
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0" title="当前 git 状态">
                    {statusText(st)}
                  </span>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenDiff(f)}
                    title="在 Git 审查中查看差异"
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary text-[10px] transition-colors"
                  >
                    <FileDiff className="w-3 h-3" />
                    <span>Diff</span>
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
            );
          })}
        </div>
      </div>
    </div>
  );
};
