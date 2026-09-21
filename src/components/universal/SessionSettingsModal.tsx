import React, { useState } from "react";
import { X, FolderGit2, Network, Boxes } from "lucide-react";
import { Button } from "../ui/button";

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
  const [cwd, setCwd] = useState("");
  const [extraDirs, setExtraDirs] = useState("");
  const [mcpJson, setMcpJson] = useState("[]");
  const [error, setError] = useState<string | null>(null);

  if (!p.isOpen) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={p.onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 space-y-4 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h2 className="font-bold text-sm">新会话设置</h2>
          <button onClick={p.onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block space-y-1">
          <span className="flex items-center gap-1.5 font-semibold text-slate-300"><FolderGit2 className="w-3.5 h-3.5" /> 工作目录 cwd（绝对路径，留空用网关默认）</span>
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder={p.defaultCwdHint || "D:/project/..."}
            spellCheck={false}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 font-mono text-[11px] outline-none focus:border-indigo-500"
          />
        </label>

        {p.supportsAdditionalDirs && (
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 font-semibold text-slate-300"><Network className="w-3.5 h-3.5" /> 额外工作区 additionalDirectories（每行一个绝对路径）</span>
            <textarea
              value={extraDirs}
              onChange={(e) => setExtraDirs(e.target.value)}
              rows={2}
              spellCheck={false}
              placeholder={"D:/shared-lib\nD:/product-docs"}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 font-mono text-[11px] outline-none focus:border-indigo-500"
            />
          </label>
        )}

        <div className="space-y-1">
          <span className="flex items-center gap-1.5 font-semibold text-slate-300">
            <Boxes className="w-3.5 h-3.5" /> MCP Servers（JSON 数组{p.supportsMcpHttp ? "，支持 stdio / http" : ""}）
          </span>
          <textarea
            value={mcpJson}
            onChange={(e) => setMcpJson(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={MCP_EXAMPLE}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 font-mono text-[11px] outline-none focus:border-indigo-500"
          />
        </div>

        {error && <div className="p-2 rounded-lg bg-rose-950/50 border border-rose-500/40 text-rose-300">{error}</div>}

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
