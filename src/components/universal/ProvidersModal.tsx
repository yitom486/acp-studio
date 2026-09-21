import React, { useState } from "react";
import { X, Cpu, RefreshCw, Ban } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { providersRpc } from "../../lib/universal-api";

export interface ProvidersModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
}

interface ProviderRow {
  providerId: string;
  supported?: string[];
  required?: boolean;
  current?: Record<string, unknown> | null;
}

export const ProvidersModal: React.FC<ProvidersModalProps> = ({ isOpen, onClose, agentId }) => {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, { apiType: string; baseUrl: string; headers: string }>>({});

  const refresh = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res: any = await providersRpc(agentId, "list", {});
      const list: ProviderRow[] = res?.providers || [];
      setProviders(list);
      const init: typeof editing = {};
      for (const pr of list) {
        init[pr.providerId] = {
          apiType: String((pr.current as any)?.apiType || pr.supported?.[0] || "openai"),
          baseUrl: String((pr.current as any)?.baseUrl || ""),
          headers: JSON.stringify((pr.current as any)?.headers || {}, null, 1),
        };
      }
      setEditing(init);
    } catch (e: any) {
      setMsg("providers/list 失败: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (isOpen) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agentId]);

  if (!isOpen) return null;

  const handleSet = async (providerId: string) => {
    const ed = editing[providerId];
    if (!ed) return;
    setMsg(null);
    try {
      let headers: Record<string, string> = {};
      if (ed.headers.trim()) headers = JSON.parse(ed.headers);
      await providersRpc(agentId, "set", { providerId, apiType: ed.apiType, baseUrl: ed.baseUrl, headers });
      setMsg(`已更新 provider ${providerId}`);
      await refresh();
    } catch (e: any) {
      setMsg("providers/set 失败: " + e.message);
    }
  };

  const handleDisable = async (providerId: string) => {
    setMsg(null);
    try {
      await providersRpc(agentId, "disable", { providerId });
      setMsg(`已禁用 provider ${providerId}`);
      await refresh();
    } catch (e: any) {
      setMsg("providers/disable 失败: " + e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-5 text-foreground space-y-3 text-xs max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-bold text-sm flex items-center gap-2"><Cpu className="w-4 h-4 text-primary" /> Providers · {agentId}</h2>
          <div className="flex items-center gap-1">
            <button onClick={refresh} title="刷新" className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {providers.map((pr) => {
          const ed = editing[pr.providerId];
          const disabled = pr.current == null;
          return (
            <div key={pr.providerId} className="p-3 rounded-xl border border-border bg-background/60 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">{pr.providerId}</span>
                {pr.required && <Badge variant="outline" className="text-[10px]">required</Badge>}
                {disabled ? <Badge variant="warning" className="text-[10px]">disabled</Badge> : <Badge variant="success" className="text-[10px]">active</Badge>}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{(pr.supported || []).join(", ")}</span>
              </div>
              {ed && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-muted-foreground">apiType</span>
                    <select
                      value={ed.apiType}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [pr.providerId]: { ...ed, apiType: e.target.value } }))}
                      className="w-full rounded-lg bg-card border border-border px-2 py-1 outline-none"
                    >
                      {(pr.supported?.length ? pr.supported : [ed.apiType]).map((t) => (
                        <option key={t} value={t} className="bg-card">{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted-foreground">baseUrl</span>
                    <input
                      value={ed.baseUrl}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [pr.providerId]: { ...ed, baseUrl: e.target.value } }))}
                      spellCheck={false}
                      placeholder="https://..."
                      className="w-full rounded-lg bg-card border border-border px-2 py-1 font-mono text-[11px] outline-none"
                    />
                  </label>
                  <label className="col-span-2 space-y-1">
                    <span className="text-muted-foreground">headers（JSON）</span>
                    <textarea
                      value={ed.headers}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [pr.providerId]: { ...ed, headers: e.target.value } }))}
                      rows={2}
                      spellCheck={false}
                      className="w-full rounded-lg bg-card border border-border px-2 py-1 font-mono text-[11px] outline-none"
                    />
                  </label>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="default" onClick={() => handleSet(pr.providerId)} className="h-7 text-[11px]">应用配置</Button>
                {!pr.required && (
                  <Button size="sm" variant="outline" onClick={() => handleDisable(pr.providerId)} className="h-7 text-[11px] gap-1">
                    <Ban className="w-3 h-3" /> 禁用
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {providers.length === 0 && !loading && <div className="text-muted-foreground">无 providers 数据。</div>}
        {msg && <div className="p-2 rounded-lg bg-background border border-border text-muted-foreground">{msg}</div>}
      </div>
    </div>
  );
};
