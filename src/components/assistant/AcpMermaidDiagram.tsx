import React, { useEffect, useId, useState } from "react";
import mermaid from "mermaid";
import { cn } from "@/lib/utils";
import { Maximize2, ZoomIn, ZoomOut, RotateCcw, Copy, Check, X } from "lucide-react";

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

interface MermaidLightboxProps {
  svg: string;
  code: string;
  onClose: () => void;
}

const MermaidLightbox: React.FC<MermaidLightboxProps> = ({ svg, code, onClose }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setScale((s) => Math.min(4, +(s + 0.25).toFixed(2)));
      else if (e.key === "-") setScale((s) => Math.max(0.25, +(s - 0.25).toFixed(2)));
      else if (e.key === "0") {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setScale((prev) => Math.min(4, Math.max(0.25, +(prev + delta).toFixed(2))));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-md animate-fade-slide-in select-none"
      onClick={onClose}
      role="dialog"
      aria-label="Mermaid 图表放大预览"
    >
      {/* 顶部工具栏 */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/80 backdrop-blur-sm z-10 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span>Mermaid 架构流程图</span>
          <span className="text-[11px] text-muted-foreground font-mono hidden sm:inline">（滚轮缩放 · 拖拽平移）</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.25, +(s - 0.25).toFixed(2)))}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="缩小 (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono px-1.5 min-w-[48px] text-center text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(4, +(s + 0.25).toFixed(2)))}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="放大 (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="重置缩放与位置 (0)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="w-[1px] h-4 bg-border mx-1" />
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="复制 Mermaid 源码"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copied ? "已复制" : "复制代码"}</span>
          </button>
          <div className="w-[1px] h-4 bg-border mx-1" />
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 主画布视口 */}
      <div
        className={cn(
          "flex-1 relative overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing",
          isDragging && "cursor-grabbing"
        )}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleReset}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="transition-transform duration-75 ease-out select-none flex items-center justify-center p-8 max-w-none"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: "center center",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
};

export default function AcpMermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

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
    <>
      <div
        data-mermaid-diagram
        className="group/mmd relative my-2 overflow-hidden rounded-lg border border-border bg-background/60 p-3 hover:border-primary/40 transition-colors"
      >
        {/* 右上角快捷操作条 */}
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/mmd:opacity-100 transition-opacity bg-card/90 border border-border/80 rounded-md p-0.5 shadow-sm z-10 backdrop-blur-xs">
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="放大查看 / 全屏预览"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="复制 Mermaid 源码"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* 图表内容，点击可直接打开全屏弹窗 */}
        <div
          className="overflow-x-auto cursor-zoom-in [&_svg]:mx-auto [&_svg]:max-w-full [&_svg]:h-auto"
          onClick={() => setLightboxOpen(true)}
          title="点击放大查看"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {lightboxOpen && (
        <MermaidLightbox
          svg={svg}
          code={code}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
