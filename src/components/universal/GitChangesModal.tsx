import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, RefreshCw, FileDiff, Columns2, AlignLeft, Plus, Undo2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BlurFade } from "@/components/magicui/blur-fade";
import { CodeComparison } from "@/components/magicui/code-comparison";
import { useThemeStore, THEMES } from "@/stores/useThemeStore";
import {
  gitStage,
  gitRestore,
  parseUnifiedDiff,
  guessLanguage,
  type GitFileChange,
  type GitFileResult,
} from "@/lib/universal-api";
import { useGitStatusQuery, useGitFileQuery, invalidateGit } from "@/lib/acp-queries";

export interface GitChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  cwd: string | null;
  initialFilePath?: string | null;
}

function statusLabel(s: string): { text: string; variant: "success" | "warning" | "destructive" | "outline" } {
  if (s === "M") return { text: "修改", variant: "outline" };
  if (s === "A") return { text: "新增", variant: "success" };
  if (s === "D") return { text: "删除", variant: "destructive" };
  if (s === "R") return { text: "改名", variant: "outline" };
  if (s === "?") return { text: "未跟踪", variant: "warning" };
  return { text: s, variant: "outline" };
}

export const GitChangesModal: React.FC<GitChangesModalProps> = ({
  isOpen,
  onClose,
  cwd,
  initialFilePath,
}) => {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"split" | "unified">("split");
  const themeId = useThemeStore((st) => st.theme);
  const [msg, setMsg] = useState<string | null>(null);

  // Server state via TanStack Query (keyed by cwd/file, auto-fetches on open).
  const statusQuery = useGitStatusQuery(cwd, isOpen);
  const files: GitFileChange[] = statusQuery.data?.files || [];
  const branch: string = statusQuery.data?.branch || "";
  const loading = statusQuery.isFetching;

  const fileQuery = useGitFileQuery(cwd, selected, isOpen);
  const detail: GitFileResult | null = (fileQuery.data as GitFileResult) ?? null;

  const refresh = () => {
    setMsg(null);
    invalidateGit(qc);
  };

  const gitMutation = useMutation({
    mutationFn: (v: { action: "stage" | "restore"; file: string }) =>
      v.action === "stage" ? gitStage(cwd as string, v.file) : gitRestore(cwd as string, v.file),
    onSuccess: () => {
      setMsg(null);
      invalidateGit(qc);
    },
    onError: (err: any) => setMsg(err.message),
  });
  const actionLoading = gitMutation.isPending ? (gitMutation.variables?.file ?? null) : null;

  const handleStage = (file: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!cwd || gitMutation.isPending) return;
    gitMutation.mutate({ action: "stage", file });
  };

  const handleRestore = (file: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!cwd || gitMutation.isPending) return;
    if (!confirm(`确定放弃对 ${file} 的修改吗？未保存的内容将丢失。`)) return;
    gitMutation.mutate({ action: "restore", file });
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Reset selection when the modal (re)opens or cwd changes.
  useEffect(() => {
    if (isOpen) setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, cwd]);

  // Follow the file list: prefer initialFilePath, else first file; drop selection when clean.
  useEffect(() => {
    if (!isOpen || !statusQuery.data) return;
    const list = statusQuery.data.files || [];
    if (list.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !list.some((f) => f.path === selected)) {
      setSelected(
        initialFilePath && list.some((f) => f.path === initialFilePath)
          ? initialFilePath
          : list[0].path
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, statusQuery.data]);

  if (!isOpen) return null;

  const queryError =
    (statusQuery.error as Error | null)?.message ?? (fileQuery.error as Error | null)?.message ?? null;
  const lines = parseUnifiedDiff(detail?.unified || null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80" onClick={onClose}>
      <div className="w-full max-w-4xl h-[82vh] rounded-2xl border border-border bg-card p-4 text-foreground text-xs flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border pb-2 shrink-0">
          <FileDiff className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm">代码变更</h2>
          {branch && <Badge variant="outline" className="font-mono text-[10px]">{branch}</Badge>}
          <Badge variant="outline" className="font-mono text-[10px]">{files.length} 个文件</Badge>
          <div className="flex-1" />
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setView("split")}
              title="前后对照"
              className={`p-1.5 ${view === "split" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Columns2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setView("unified")}
              title="统一 diff"
              className={`p-1.5 ${view === "unified" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <AlignLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          <button onClick={refresh} title="刷新" className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {(msg || queryError) && <div className="p-2 mt-2 rounded-lg bg-background border border-border text-muted-foreground shrink-0">{msg || queryError}</div>}
        {!cwd && <div className="p-4 text-muted-foreground">无会话工作目录：先打开或新建一个会话。</div>}

        <div className="flex flex-1 min-h-0 gap-3 pt-2">
          <div className="w-56 shrink-0 overflow-y-auto space-y-1 pr-1">
            {files.map((f) => {
              const lab = statusLabel(f.status);
              return (
                <div
                  key={f.path}
                  onClick={() => setSelected(f.path)}
                  className={`group/item flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer border ${
                    selected === f.path ? "bg-muted border-primary/40" : "border-transparent hover:bg-muted/60"
                  }`}
                >
                  <Badge variant={lab.variant} className="text-[10px] px-1 h-4 shrink-0">{lab.text}</Badge>
                  <span className="font-mono truncate flex-1 text-[11px]" title={f.path}>{f.path}</span>
                  {/* Actions on hover: stage and restore */}
                  <div className="opacity-0 group-hover/item:opacity-100 flex items-center gap-1 shrink-0 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => handleStage(f.path, e)}
                      disabled={actionLoading === f.path}
                      title="暂存该文件 (git add)"
                      className="p-1 rounded text-muted-foreground hover:text-success hover:bg-success/10 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleRestore(f.path, e)}
                      disabled={actionLoading === f.path}
                      title="放弃更改 (git restore)"
                      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Undo2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
            {files.length === 0 && !loading && !msg && (
              <div className="text-muted-foreground p-2">工作区干净，无变更。</div>
            )}
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto rounded-xl border border-border bg-background/60 p-2">
            {!selected ? (
              <div className="text-muted-foreground p-3">左侧选择文件查看变更。</div>
            ) : !detail ? (
              <div className="text-muted-foreground p-3">加载中…</div>
            ) : detail.binary ? (
              <div className="text-muted-foreground p-3">二进制文件，跳过内容展示。</div>
            ) : view === "split" && detail.after !== null ? (
              <BlurFade key={selected}>
                <CodeComparison
                  beforeCode={detail.before ?? ""}
                  afterCode={detail.after}
                  language={guessLanguage(detail.file)}
                  filename={detail.file}
                  theme={THEMES[themeId]?.isDark === false ? "light" : "dark"}
                />
              </BlurFade>
            ) : (
              <div className="font-mono text-[11px] leading-relaxed">
                {lines.length === 0 && <div className="text-muted-foreground p-2">暂无文本差异（如纯新增/删除文件请切“前后对照”）。</div>}
                {lines.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.kind === "hunk"
                        ? "text-primary py-1"
                        : l.kind === "add"
                        ? "bg-success/10 text-foreground px-2 rounded"
                        : l.kind === "del"
                        ? "bg-destructive/10 text-foreground px-2 rounded"
                        : "text-muted-foreground px-2"
                    }
                  >
                    <span className="select-none opacity-50 mr-2">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : l.kind === "hunk" ? "@" : " "}</span>
                    <span className="break-all whitespace-pre-wrap">{l.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
