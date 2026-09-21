import React, { useState } from "react";
import { X, RefreshCw, Check, Search, Cpu } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { parseModelId, type ModelCatalog, type ConfigOptionLike } from "../../lib/universal-api";

export interface ModelBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  catalog: ModelCatalog | null;
  modelOption?: ConfigOptionLike | null;
  currentModelId?: string;
  discovering: boolean;
  onRefresh: () => void;
  onApply: (modelId: string) => void;
}

/** Normalize catalog entries + config select options into one browsable list. */
function allModels(catalog: ModelCatalog | null, modelOption?: ConfigOptionLike | null): Array<{ modelId: string; name: string; description?: string; source: "catalog" | "config" }> {
  const out: Array<{ modelId: string; name: string; description?: string; source: "catalog" | "config" }> = [];
  const seen = new Set<string>();
  for (const m of catalog?.availableModels || []) {
    if (!m?.modelId || seen.has(m.modelId)) continue;
    seen.add(m.modelId);
    out.push({ modelId: m.modelId, name: m.name || parseModelId(m.modelId).model, description: m.description, source: "catalog" });
  }
  for (const o of modelOption?.options || []) {
    const id = String(o.value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ modelId: id, name: o.name || id, description: o.description, source: "config" });
  }
  return out;
}

export const ModelBrowserModal: React.FC<ModelBrowserModalProps> = (p) => {
  const [query, setQuery] = useState("");
  if (!p.isOpen) return null;

  const models = allModels(p.catalog, p.modelOption);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? models.filter((m) => m.modelId.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || (m.description || "").toLowerCase().includes(q))
    : models;
  const current = p.currentModelId || p.catalog?.currentModelId || "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={p.onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 space-y-3 text-xs max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" /> 模型库
            <Badge variant="outline" className="font-mono text-[10px]">{models.length} 个可用</Badge>
          </h2>
          <div className="flex items-center gap-1">
            <button onClick={p.onRefresh} title="向 Agent 重新发现模型目录" className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800">
              <RefreshCw className={`w-4 h-4 ${p.discovering ? "animate-spin" : ""}`} />
            </button>
            <button onClick={p.onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模型名称 / ID / 描述…"
            className="w-full rounded-lg bg-slate-950 border border-slate-700 pl-8 pr-3 py-1.5 outline-none focus:border-indigo-500"
          />
        </div>

        <div className="overflow-y-auto space-y-1.5 pr-0.5">
          {filtered.map((m) => {
            const parsed = parseModelId(m.modelId);
            const isCurrent = current === m.modelId || current === parsed.model;
            return (
              <div
                key={m.modelId}
                onClick={() => p.onApply(m.modelId)}
                className={`p-2.5 rounded-xl border cursor-pointer transition-colors ${
                  isCurrent ? "border-indigo-500/60 bg-indigo-950/40" : "border-slate-800 hover:border-slate-600 hover:bg-slate-800/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100">{m.name}</span>
                  {isCurrent && (
                    <Badge variant="success" className="text-[10px] gap-1"><Check className="w-3 h-3" />当前</Badge>
                  )}
                  {parsed.effort && (
                    <Badge variant="outline" className="text-[10px] font-mono">思考 {parsed.effort}</Badge>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-slate-500 truncate max-w-[180px]" title={m.modelId}>{m.modelId}</span>
                </div>
                {m.description && <div className="text-slate-400 mt-0.5 leading-snug">{m.description}</div>}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-slate-500 py-4 text-center">
              {models.length === 0 ? "该 Agent 未广播模型目录，可点右上刷新重新发现。" : "无匹配模型。"}
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-1 border-t border-slate-800 text-[11px] text-slate-500">
          <span>点选即切换（catalog 自带思考等级会自动联动）</span>
          <Button size="sm" variant="secondary" onClick={p.onClose} className="text-xs">关闭</Button>
        </div>
      </div>
    </div>
  );
};
