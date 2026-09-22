import React, { useState, useEffect } from "react";
import { X, FolderGit2, Network, Boxes, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const [cwd, setCwd] = useState(p.defaultCwdHint || "");
  const [extraDirs, setExtraDirs] = useState("");
  const [mcpJson, setMcpJson] = useState("[]");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (p.isOpen && !cwd && p.defaultCwdHint) {
      setCwd(p.defaultCwdHint);
    }
  }, [p.isOpen, p.defaultCwdHint, cwd]);

  if (!p.isOpen) return null;

  const handleBrowseCwd = async () => {
    if (window.acpStudio?.openDirectory) {
      try {
        const chosen = await window.acpStudio.openDirectory();
        if (chosen) setCwd(chosen);
      } catch (err: any) {
        setError("选择文件夹失败: " + err.message);
      }
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md" onClick={p.onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 text-foreground space-y-4 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-bold text-sm">新会话设置</h2>
          <button onClick={p.onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1">
          <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
            <FolderGit2 className="w-3.5 h-3.5" /> 工作目录 cwd（绝对路径，留空用工作区默认）
          </span>
          <div className="flex items-center gap-2">
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder={p.defaultCwdHint || "D:/project/..."}
              spellCheck={false}
              className="flex-1 rounded-lg bg-background border border-border px-3 py-1.5 font-mono text-[11px] outline-none focus:border-primary"
            />
            {typeof window !== "undefined" && Boolean(window.acpStudio?.openDirectory) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleBrowseCwd}
                className="h-8 px-2.5 text-xs gap-1 shrink-0"
                title="选择本地文件夹"
              >
                <FolderOpen className="w-3.5 h-3.5 text-primary" />
                <span>浏览</span>
              </Button>
            )}
          </div>
        </div>

        {p.supportsAdditionalDirs && (
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 font-semibold text-muted-foreground"><Network className="w-3.5 h-3.5" /> 额外工作区 additionalDirectories（每行一个绝对路径）</span>
            <textarea
              value={extraDirs}
              onChange={(e) => setExtraDirs(e.target.value)}
              rows={2}
              spellCheck={false}
              placeholder={"D:/shared-lib\nD:/product-docs"}
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
