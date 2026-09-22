import React, { useEffect, useState } from "react";
import { AlertTriangle, X, Copy, Check, Trash2 } from "lucide-react";
import { BlurFade } from "@/components/magicui/blur-fade";
import { subscribeErrors, dismissError, clearErrors, type AppError } from "@/lib/error-bus";

/**
 * Central error toasts, mounted beside <App/> (outside the ErrorBoundary)
 * so they stay visible even when the main tree crashes.
 */
export const ErrorToast: React.FC = () => {
  const [errors, setErrors] = useState<AppError[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeErrors(setErrors), []);
  if (errors.length === 0) return null;

  const copy = (e: AppError) => {
    navigator.clipboard.writeText(`[${e.source}] ${e.message}\n${e.detail || ""}`).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-80 space-y-2 text-xs">
      {errors.slice(0, 4).map((e) => (
        <BlurFade key={e.id}>
          <div className="rounded-xl border border-destructive/40 bg-card/95 p-3 shadow-xl backdrop-blur-md space-y-1.5">
            <div className="flex items-center gap-1.5 text-destructive font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate flex-1">{e.source}</span>
              <button onClick={() => copy(e)} title="复制" className="text-muted-foreground hover:text-foreground">
                {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => dismissError(e.id)} title="忽略" className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div
              className="text-foreground leading-snug break-words cursor-pointer"
              onClick={() => setExpanded((prev) => (prev === e.id ? null : e.id))}
              title="点击展开堆栈"
            >
              {e.message}
            </div>
            {expanded === e.id && e.detail && (
              <pre className="max-h-28 overflow-y-auto rounded bg-background/80 border border-border p-2 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap">
                {e.detail}
              </pre>
            )}
          </div>
        </BlurFade>
      ))}
      {errors.length > 1 && (
        <button
          onClick={clearErrors}
          className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Trash2 className="w-3 h-3" /> 全部清除
        </button>
      )}
    </div>
  );
};
