import React, { useEffect, useId, useState } from "react";
import mermaid from "mermaid";
import { cn } from "@/lib/utils";

/**
 * Mermaid diagram renderer — lives behind React.lazy so the ~MB
 * mermaid+d3 dependency graph only loads when a mermaid fence appears.
 * Security: `securityLevel: "strict"` (DOMPurify-sanitized SVG, no scripts/
 * clicks); errors fall back to the classic code fence, never a blank box.
 */
let initialized = false;
function ensureInit() {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "dark",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  });
  initialized = true;
}

export default function AcpMermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = `aui-mmd-${rawId}`;

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    ensureInit();
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    return (
      <div className="my-2">
        <div className="rounded-t-lg border border-b-0 border-border bg-background/80 px-3 py-1 font-mono text-[11px] text-warning">
          图表语法无法渲染，已回退为代码（{error.slice(0, 120)}）
        </div>
        <pre className="overflow-x-auto rounded-b-lg border border-border bg-background/80 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        className="my-2 flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-4 text-xs text-muted-foreground"
        role="status"
      >
        <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
        <span className="animate-pulse">图表渲染中…</span>
      </div>
    );
  }

  return (
    <div
      data-mermaid-diagram
      className={cn(
        "my-2 overflow-x-auto rounded-lg border border-border bg-background/60 p-3",
        "[&_svg]:mx-auto [&_svg]:max-w-full [&_svg]:h-auto",
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
