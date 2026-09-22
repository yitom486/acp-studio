import React, { useState } from "react";
import { X, RefreshCw, Check, Search, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseModelId, type ModelCatalog, type ConfigOptionLike } from "@/lib/universal-api";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md" onClick={p.onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-5 text-foreground space-y-3 text-xs max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" /> 模型库
            <Badge variant="outline" className="font-mono text-[10px]">{models.length} 个可用</Badge>
          </h2>
          <div className="flex items-center gap-1">
            <button onClick={p.onRefresh} title="向 Agent 重新发现模型目录" className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted">
              <RefreshCw className={`w-4 h-4 ${p.discovering ? "animate-spin" : ""}`} />
            </button>
            <button onClick={p.onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模型名称 / ID / 描述…"
            className="w-full rounded-lg bg-background border border-border pl-8 pr-3 py-1.5 outline-none focus:border-primary"
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
                  isCurrent ? "border-primary/60 bg-muted/40" : "border-border hover:border-muted-foreground hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{m.name}</span>
                  {isCurrent && (
                    <Badge variant="success" className="text-[10px] gap-1"><Check className="w-3 h-3" />当前</Badge>
                  )}
                  {parsed.effort && (
                    <Badge variant="outline" className="text-[10px] font-mono">思考 {parsed.effort}</Badge>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground truncate max-w-[180px]" title={m.modelId}>{m.modelId}</span>
                </div>
                {m.description && <div className="text-muted-foreground mt-0.5 leading-snug">{m.description}</div>}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-muted-foreground py-4 text-center">
              {models.length === 0 ? "该 Agent 未广播模型目录，可点右上刷新重新发现。" : "无匹配模型。"}
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-1 border-t border-border text-[11px] text-muted-foreground">
          <span>点选即切换（catalog 自带思考等级会自动联动）</span>
          <Button size="sm" variant="secondary" onClick={p.onClose} className="text-xs">关闭</Button>
        </div>
      </div>
    </div>
  );
};
