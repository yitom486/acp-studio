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
    <header className="h-16 border-b border-border/80 bg-background/80 backdrop-blur-xl px-6 flex items-center justify-between z-30 shrink-0">
      {/* Brand logo & status */}
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-primary shadow-lg shadow-black/30">
          <Sparkles className="w-5 h-5 text-foreground" />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-success border-2 border-background"></span>
          </span>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight text-foreground flex items-center gap-1.5">
              Antigravity <span className="text-primary font-extrabold">Studio</span>
            </h1>
            <Badge variant="success" className="h-5 text-[10px] px-1.5 font-mono font-medium">
              {status?.mode === "process" ? "ACP Process Mode" : "agy-acp-map Active"}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
            @yitom/agy-acp-map v{status?.packageVersion || "0.1.3"} &bull; {status?.protocol || "ACP v2"}
          </p>
        </div>
      </div>

      {/* Center options: Model & Mode selectors */}
      <div className="hidden md:flex items-center gap-3">
        {/* Model Selector */}
        <div className="relative flex items-center">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border/70 bg-card/90 text-xs font-medium text-foreground hover:border-muted-foreground transition-colors shadow-sm">
            <Cpu className="w-3.5 h-3.5 text-primary" />
            <select
              value={selectedModel}
              onChange={(e) => onSelectModel(e.target.value)}
              disabled={isStreaming}
              className="bg-transparent text-foreground outline-none cursor-pointer pr-4 appearance-none font-medium"
            >
              {models.length > 0 ? (
                models.map((m) => (
                  <option key={m.id} value={m.id} className="bg-card text-foreground">
                    {m.name}
                  </option>
                ))
              ) : (
                <option value="gemini-3.8-flash-high" className="bg-card text-foreground">
                  Gemini 3.8 Flash (High)
                </option>
              )}
            </select>
            <ChevronDown className="w-3 h-3 text-muted-foreground pointer-events-none -ml-3" />
          </div>
        </div>

        {/* Execution Mode Selector */}
        <div className="flex items-center rounded-xl border border-border bg-card/60 p-1 text-xs">
          <button
            onClick={() => onSelectMode("default")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
              selectedMode === "default"
                ? "bg-primary text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Normal
          </button>
          <button
            onClick={() => onSelectMode("plan")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
              selectedMode === "plan"
                ? "bg-primary text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Plan 模式
          </button>
          <button
            onClick={() => onSelectMode("bypassPermissions")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
              selectedMode === "bypassPermissions"
                ? "bg-warning text-warning-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
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
          className="gap-1.5 text-xs text-muted-foreground border-border/80 hover:bg-muted"
        >
          <PlusCircle className="w-3.5 h-3.5 text-muted-foreground" />
          新会话
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={onOpenAuth}
          className="gap-2 text-xs bg-muted/90 border border-border hover:border-primary/50 hover:bg-border/80 transition-all"
        >
          <ShieldCheck className="w-4 h-4 text-success" />
          <span className="hidden sm:inline">Google 认证</span>
          <span className="w-2 h-2 rounded-full bg-success"></span>
        </Button>
      </div>
    </header>
  );
};
