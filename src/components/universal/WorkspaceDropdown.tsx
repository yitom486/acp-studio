import React, { useState, useRef, useEffect } from "react";
import { Folder, FolderOpen, ExternalLink, ChevronDown, Check, Clock } from "lucide-react";
import { validateWorkspace } from "@/lib/universal-api";
import type { RecentWorkspace } from "@/stores/useStudioStore";

export interface WorkspaceDropdownProps {
  currentWorkspace: string | null;
  recentWorkspaces: RecentWorkspace[];
  onSelectWorkspace: (path: string, name?: string) => void;
}

export const WorkspaceDropdown: React.FC<WorkspaceDropdownProps> = ({
  currentWorkspace,
  recentWorkspaces,
  onSelectWorkspace,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const projectName = currentWorkspace
    ? currentWorkspace.split(/[/\\]/).filter(Boolean).pop() || currentWorkspace
    : null;

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  // Handle native folder dialog or web fallback
  const handleOpenFolder = async () => {
    setOpen(false);
    if (window.acpStudio?.openDirectory) {
      try {
        const chosen = await window.acpStudio.openDirectory();
        if (chosen) {
          onSelectWorkspace(chosen);
        }
      } catch (err: any) {
        alert("打开文件夹失败: " + err.message);
      }
      return;
    }

    // Web fallback
    const input = prompt("请输入本地项目工作区绝对路径 (如 D:\\project\\my-app):", currentWorkspace || "");
    if (!input || !input.trim()) return;
    const res = await validateWorkspace(input.trim());
    if (res.ok && res.path) {
      onSelectWorkspace(res.path, res.name);
    } else {
      alert("无效目录: " + (res.error || "路径不存在或不是目录"));
    }
  };

  const handleRevealInExplorer = async () => {
    setOpen(false);
    if (currentWorkspace && window.acpStudio?.openPath) {
      await window.acpStudio.openPath(currentWorkspace);
    }
  };

  return (
    <div className="relative flex items-center app-no-drag" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={currentWorkspace ? `当前工作区: ${currentWorkspace}` : "点击选择本地工作区目录"}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/70 bg-card/70 hover:bg-card text-xs text-foreground transition-colors max-w-[170px] sm:max-w-[210px] group"
      >
        <Folder className="w-3.5 h-3.5 text-primary shrink-0 group-hover:scale-105 transition-transform" />
        <span className="truncate font-medium">
          {projectName || "打开工作区…"}
        </span>
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 ml-0.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-64 p-1 rounded-xl border border-border bg-popover/95 shadow-2xl text-xs z-50 backdrop-blur-md animate-in fade-in-50 zoom-in-95 duration-100">
          {/* Open Folder Action */}
          <button
            type="button"
            onClick={handleOpenFolder}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-foreground hover:bg-muted/80 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FolderOpen className="w-3.5 h-3.5 text-primary" />
              <span className="font-medium">打开文件夹…</span>
            </div>
            <kbd className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/60">
              Ctrl+O
            </kbd>
          </button>

          {/* Reveal in explorer (Electron only) */}
          {currentWorkspace && window.acpStudio?.openPath && (
            <button
              type="button"
              onClick={handleRevealInExplorer}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>在资源管理器中显示</span>
            </button>
          )}

          {/* Recent Workspaces section */}
          {recentWorkspaces.length > 0 && (
            <>
              <div className="my-1 border-t border-border/60 px-2 py-1 text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>最近打开的项目</span>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {recentWorkspaces.map((rw) => {
                  const isCurrent = rw.path === currentWorkspace;
                  return (
                    <button
                      key={rw.path}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onSelectWorkspace(rw.path, rw.name);
                      }}
                      title={rw.path}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                        isCurrent
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                      }`}
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="truncate text-xs">{rw.name}</span>
                        <span className="truncate text-[10px] text-muted-foreground/70 font-mono">
                          {rw.path}
                        </span>
                      </div>
                      {isCurrent && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
