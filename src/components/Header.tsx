import React from "react";
import { Sparkles, ShieldCheck, Cpu, Terminal, RefreshCw, PlusCircle, CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export interface HeaderProps {
  status: any;
  models: Array<{ id: string; name: string }>;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  selectedMode: string;
  onSelectMode: (mode: string) => void;
  onOpenAuth: () => void;
  onNewSession: () => void;
  isStreaming: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  models,
  selectedModel,
  onSelectModel,
  selectedMode,
  onSelectMode,
  onOpenAuth,
  onNewSession,
  isStreaming,
}) => {
  return (
    <header className="h-16 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl px-6 flex items-center justify-between z-30 shrink-0">
      {/* Brand logo & status */}
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 shadow-lg shadow-indigo-500/25">
          <Sparkles className="w-5 h-5 text-white" />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-slate-950"></span>
          </span>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
              Antigravity <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 font-extrabold">ACP Studio</span>
            </h1>
            <Badge variant="success" className="h-5 text-[10px] px-1.5 font-mono font-medium">
              Official ACP Active
            </Badge>
          </div>
          <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
            agy_acp_server &bull; Google LLC
          </p>
        </div>
      </div>

      {/* Center options: Model & Mode selectors */}
      <div className="hidden md:flex items-center gap-3">
        {/* Model Selector */}
        <div className="relative flex items-center">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700/70 bg-slate-900/90 text-xs font-medium text-slate-200 hover:border-slate-600 transition-colors shadow-sm">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <select
              value={selectedModel}
              onChange={(e) => onSelectModel(e.target.value)}
              disabled={isStreaming}
              className="bg-transparent text-slate-200 outline-none cursor-pointer pr-4 appearance-none font-medium"
            >
              {models.length > 0 ? (
                models.map((m) => (
                  <option key={m.id} value={m.id} className="bg-slate-900 text-slate-100">
                    {m.name}
                  </option>
                ))
              ) : (
                <option value="gemini-3.8-flash-high" className="bg-slate-900 text-slate-100">
                  Gemini 3.8 Flash (High)
                </option>
              )}
            </select>
            <ChevronDown className="w-3 h-3 text-slate-400 pointer-events-none -ml-3" />
          </div>
        </div>

        {/* Execution Mode Selector */}
        <div className="flex items-center rounded-xl border border-slate-800 bg-slate-900/60 p-1 text-xs">
          <button
            onClick={() => onSelectMode("default")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
              selectedMode === "default"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Normal
          </button>
          <button
            onClick={() => onSelectMode("plan")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
              selectedMode === "plan"
                ? "bg-purple-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Plan 模式
          </button>
          <button
            onClick={() => onSelectMode("bypassPermissions")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
              selectedMode === "bypassPermissions"
                ? "bg-amber-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            YOLO (免审)
          </button>
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onNewSession}
          disabled={isStreaming}
          className="gap-1.5 text-xs text-slate-300 border-slate-700/80 hover:bg-slate-800"
        >
          <PlusCircle className="w-3.5 h-3.5 text-slate-400" />
          新会话
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={onOpenAuth}
          className="gap-2 text-xs bg-slate-800/90 border border-slate-700 hover:border-indigo-500/50 hover:bg-slate-700/80 transition-all"
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="hidden sm:inline">Google 认证</span>
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
        </Button>
      </div>
    </header>
  );
};
