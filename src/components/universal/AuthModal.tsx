import React, { useState } from "react";
import { X, ShieldCheck, LogOut, RefreshCw, Key } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import type { AgentSummary } from "../../lib/universal-api";
import { authenticateAgent } from "../../lib/universal-api";

export interface UniversalAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: AgentSummary | undefined;
  onAuthenticated: () => void;
  onLogout: () => void;
  /** Local-auth probe result from App (session/list without authenticate). */
  authOk?: boolean | null;
}

export const UniversalAuthModal: React.FC<UniversalAuthModalProps> = ({ isOpen, onClose, agent, onAuthenticated, onLogout, authOk }) => {
  const [methodId, setMethodId] = useState("");
  const [extraJson, setExtraJson] = useState("{}");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!isOpen) return null;
  const methods = agent?.status?.authMethods || [];
  const activeMethod = methodId || methods[0]?.id || "";

  const runAuth = async () => {
    if (!agent || !activeMethod) {
      setMsg("该 Agent 未广播 authMethods，无需认证或暂不支持。");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      let extra: Record<string, unknown> = {};
      // convenience: api-key method + key input -> try common shapes
      if (apiKey.trim()) {
        extra = { apiKey: apiKey.trim(), api_key: apiKey.trim(), key: apiKey.trim(), token: apiKey.trim() };
      }
      if (extraJson.trim() && extraJson.trim() !== "{}") {
        try {
          extra = { ...extra, ...JSON.parse(extraJson) };
        } catch {
          throw new Error("附加参数不是合法 JSON");
        }
      }
      await authenticateAgent(agent.id, activeMethod, extra);
      setMsg("认证成功，可以开始会话。");
      onAuthenticated();
    } catch (e: any) {
      setMsg("认证失败: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="font-bold">认证 · {agent?.title || agent?.id}</h2>
              <p className="text-xs text-slate-400 font-mono">{agent?.command} {(agent?.args || []).join(" ")}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {authOk === true && (
          <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200">
            本地登录态复用成功：该 Agent 可直接创建会话，无需再走 authenticate（如 codex 会自动读取你本地 ~/.codex/auth.json）。
          </div>
        )}
        {authOk === false && (
          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200">
            本地暂无可用登录态（探测 session/list 返回需认证），请在下方选择一种方式完成 authenticate。
          </div>
        )}

        {methods.length === 0 ? (
          <p className="text-xs text-slate-400">该 Agent 未声明 authMethods（initialize.authMethods 为空），通常可直接创建会话。若实际遇到 auth_required，请在 Agent 文档中确认登录方式（如 codex 需先 `codex login` 或配置 OPENAI_API_KEY 后重连）。</p>
        ) : (
          <div className="space-y-2">
            {methods.map((m) => (
              <label key={m.id} className={`flex gap-2 p-2.5 rounded-xl border cursor-pointer text-xs ${activeMethod === m.id ? "border-indigo-500 bg-indigo-950/40" : "border-slate-700"}`}>
                <input type="radio" name="authm" checked={activeMethod === m.id} onChange={() => setMethodId(m.id)} />
                <div>
                  <div className="font-semibold text-slate-100">{m.name || m.id} <span className="font-mono text-slate-400">{m.id}</span></div>
                  {m.description && <div className="text-slate-400">{m.description}</div>}
                  {m.type && <Badge variant="outline" className="mt-1 text-[10px] font-mono">type: {m.type}</Badge>}
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold"><Key className="w-3.5 h-3.5" /> API Key 快捷填写（可选，适用于 api-key 方式）</div>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-... / CODEX_API_KEY"
            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs outline-none focus:border-indigo-500"
          />
          <div className="text-slate-500">附加参数 JSON（可选，高级）</div>
          <textarea
            value={extraJson}
            onChange={(e) => setExtraJson(e.target.value)}
            rows={2}
            spellCheck={false}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 font-mono text-[11px] outline-none focus:border-indigo-500"
          />
        </div>

        {msg && <div className="text-xs p-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-300">{msg}</div>}

        <div className="flex justify-between pt-2 border-t border-slate-800">
          <Button size="sm" variant="outline" onClick={onLogout} className="text-xs gap-1.5">
            <LogOut className="w-3.5 h-3.5" /> logout
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onClose} className="text-xs">关闭</Button>
            <Button size="sm" variant="default" onClick={runAuth} disabled={busy} className="text-xs gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> {busy ? "认证中..." : "authenticate"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
