import React, { useState, useEffect } from "react";
import { X, FolderGit2, Network, Boxes, FolderOpen, AlertTriangle, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { isAppInstallPath } from "@/stores/useStudioStore";

export interface SessionSettings {
  cwd: string;
  additionalDirectories: string[];
  mcpServers: unknown[];
}

export interface SessionSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (s: SessionSettings) => void;
  busy: boolean;
  defaultCwdHint?: string;
  supportsAdditionalDirs: boolean;
  supportsMcpHttp: boolean;
}

const MCP_EXAMPLE = `[
  { "name": "filesystem", "command": "/path/to/mcp-server", "args": ["--stdio"], "env": [] }
]`;

export const SessionSettingsModal: React.FC<SessionSettingsModalProps> = (p) => {
  const isWslNative = typeof localStorage !== "undefined" && Boolean(localStorage.getItem("acp_wsl_native_distro"));
  const wslDistro = typeof localStorage !== "undefined" ? localStorage.getItem("acp_wsl_native_distro") : null;
  // 过滤掉应用安装目录与 WSL /mnt/... 挂载路径
  const cleanHint = (isAppInstallPath(p.defaultCwdHint) ? "" : p.defaultCwdHint) || "";
  const effectiveHint = (isWslNative && cleanHint && /^\/mnt\/[a-zA-Z](\/|$)/i.test(cleanHint))
    ? ""
    : cleanHint;

  const [cwd, setCwd] = useState(effectiveHint);
  const [extraDirs, setExtraDirs] = useState("");
  const [mcpJson, setMcpJson] = useState("[]");
  const [error, setError] = useState<string | null>(null);

  const prevOpenRef = React.useRef(false);
  const prevHintRef = React.useRef(effectiveHint);

  const openWorkspacePicker = useWorkbenchStore((s) => s.openWorkspacePicker);
  const isMntPath = /^\/mnt\/[a-zA-Z](\/|$)/i.test(cwd.trim());

  useEffect(() => {
    // 弹窗重新开启，或者外部传入的目标工作区改变时，强制同步重置 cwd，彻底消除状态锁死
    if (p.isOpen && (!prevOpenRef.current || prevHintRef.current !== effectiveHint)) {
      setCwd(effectiveHint);
      setError(null);
    }
    prevOpenRef.current = p.isOpen;
    prevHintRef.current = effectiveHint;
  }, [p.isOpen, effectiveHint]);

  if (!p.isOpen) return null;

  const handleBrowseCwd = () => {
    const fallbackPath = isAppInstallPath(cwd) ? "" : cwd;
    const fallbackHint = isAppInstallPath(p.defaultCwdHint) ? "" : p.defaultCwdHint;
    openWorkspacePicker({
      initialPath: fallbackPath || fallbackHint || undefined,
      title: isWslNative ? `选择 WSL (${wslDistro || "Ubuntu"}) 工作目录 (cwd)` : "选择会话工作目录 (cwd)",
      confirmLabel: "选择此目录",
      onSelect: (chosen) => {
        setCwd(chosen);
      },
    });
  };

  const handleCreate = () => {
    setError(null);
    let mcp: unknown[] = [];
    if (mcpJson.trim()) {
      try {
        const parsed = JSON.parse(mcpJson);
        if (!Array.isArray(parsed)) throw new Error("须为数组");
        mcp = parsed;
      } catch (e: any) {
        setError("MCP JSON 非法: " + e.message);
        return;
      }
    }
    const additionalDirectories = extraDirs
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    p.onCreate({ cwd: cwd.trim(), additionalDirectories, mcpServers: mcp });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80" onClick={p.onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 text-foreground space-y-4 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-bold text-sm">新会话设置</h2>
          <button onClick={p.onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
            <FolderGit2 className="w-3.5 h-3.5" /> 工作目录 cwd（绝对路径，留空用工作区默认）
          </span>
          <div className="flex items-center gap-2">
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder={effectiveHint || (isWslNative || cwd.startsWith("/") ? "~ 或 /home/username/project" : "D:/project/...")}
              spellCheck={false}
              className="flex-1 rounded-lg bg-background border border-border px-3 py-1.5 font-mono text-[11px] outline-none focus:border-primary"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleBrowseCwd}
              className="h-8 px-2.5 text-xs gap-1 shrink-0"
              title={isWslNative ? "浏览 WSL 原生 Linux 目录" : "选择工作目录"}
            >
              <FolderOpen className="w-3.5 h-3.5 text-primary" />
              <span>浏览</span>
            </Button>
          </div>

          {/* WSL 原生快捷项 */}
          {isWslNative && (
            <div className="flex items-center gap-1.5 pt-0.5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Terminal className="w-3 h-3 text-emerald-500" />
                <span>WSL 原生:</span>
              </span>
              <button
                type="button"
                onClick={handleBrowseCwd}
                className="rounded px-1.5 py-0.5 bg-muted hover:bg-accent text-foreground font-mono transition-colors border border-border/40"
                title="浏览 WSL 原生 Linux 目录"
              >
                浏览 ext4 目录…
              </button>
            </div>
          )}

          {/* 检测到 Windows 跨界挂载盘 (/mnt/...) 时的性能警示与一键指引 */}
          {isMntPath && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 border border-amber-500/25 px-2.5 py-1.5 text-[11px] text-amber-500">
              <div className="flex items-center gap-1.5 min-w-0">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">当前路径在 Windows 挂载盘 (/mnt/...)，跨界 9P I/O 开销较大</span>
              </div>
              <button
                type="button"
                onClick={handleBrowseCwd}
                className="underline hover:text-amber-400 font-medium shrink-0 ml-1 text-xs"
              >
                选择 WSL 原生目录
              </button>
            </div>
          )}
        </div>

        {p.supportsAdditionalDirs && (
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 font-semibold text-muted-foreground"><Network className="w-3.5 h-3.5" /> 额外工作区 additionalDirectories（每行一个绝对路径）</span>
            <textarea
              value={extraDirs}
              onChange={(e) => setExtraDirs(e.target.value)}
              rows={2}
              spellCheck={false}
              placeholder={isWslNative ? "/home/username/shared-lib\n/home/username/docs" : "D:/shared-lib\nD:/product-docs"}
              className="w-full rounded-lg bg-background border border-border px-3 py-1.5 font-mono text-[11px] outline-none focus:border-primary"
            />
          </label>
        )}

        <div className="space-y-1">
          <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
            <Boxes className="w-3.5 h-3.5" /> MCP Servers（JSON 数组{p.supportsMcpHttp ? "，支持 stdio / http" : ""}）
          </span>
          <textarea
            value={mcpJson}
            onChange={(e) => setMcpJson(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={MCP_EXAMPLE}
            className="w-full rounded-lg bg-background border border-border px-3 py-1.5 font-mono text-[11px] outline-none focus:border-primary"
          />
        </div>

        {error && <div className="p-2 rounded-lg bg-destructive/50 border border-destructive/40 text-destructive">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="secondary" onClick={p.onClose} className="text-xs">取消</Button>
          <Button size="sm" variant="default" onClick={handleCreate} disabled={p.busy} className="text-xs">
            {p.busy ? "创建中…" : "创建会话"}
          </Button>
        </div>
      </div>
    </div>
  );
};
