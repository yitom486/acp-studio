import React, { useEffect, useState } from "react";
import { Download, ImageOff, X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import type { ImageMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";

/**
 * 聊天图片：agent 图片 part 与 markdown 图片共用。
 * 缩略图 + 点击灯箱（缩放/平移/原图/下载/Escape 关闭）；SVG 以 <img> 呈现，
 * 脚本不执行，与浏览器原生语义一致，安全。
 */

const ImageLightbox: React.FC<{ src: string; alt: string; onClose: () => void }> = ({
  src,
  alt,
  onClose,
}) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setScale((s) => Math.min(4, +(s + 0.25).toFixed(2)));
      else if (e.key === "-") setScale((s) => Math.max(0.25, +(s - 0.25).toFixed(2)));
      else if (e.key === "0") {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
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

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-md animate-fade-slide-in select-none"
      onClick={onClose}
      role="dialog"
      aria-label={alt || "图片预览"}
    >
      {/* 顶部工具栏 */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/80 backdrop-blur-sm z-10 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-foreground truncate max-w-[50%]">
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
          <span className="truncate">{alt || "图片放大预览"}</span>
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
            title="重置缩放 (0)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="w-[1px] h-4 bg-border mx-1" />
          {/^(data:|blob:|https?:)/.test(src) && (
            <a
              href={src}
              download={alt || "image"}
              onClick={(e) => e.stopPropagation()}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="下载图片"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
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
          "flex-1 relative overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing p-4 md:p-8",
          isDragging && "cursor-grabbing"
        )}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleReset}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt || "图片"}
          draggable={false}
          className="max-w-full max-h-[85vh] object-contain rounded-xl border border-border shadow-2xl transition-transform duration-75 ease-out select-none pointer-events-none"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: "center center",
          }}
        />
      </div>
    </div>
  );
};

export const AcpImageView: React.FC<{ src: string; alt?: string }> = ({ src, alt }) => {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setOpen(false);
  }, [src]);

  if (!src) return null;
  if (failed) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-3 text-xs text-muted-foreground">
        <ImageOff className="w-4 h-4 shrink-0" />
        <span className="truncate">图片加载失败{alt ? `：${alt}` : ""}</span>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group/img relative block my-2 max-w-full overflow-hidden rounded-lg border border-border bg-background/60 text-left"
        title="点击放大"
      >
        <img
          src={src}
          alt={alt || "图片"}
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-72 w-auto max-w-full object-contain"
        />
        <span className="absolute bottom-1.5 right-1.5 p-1.5 rounded-full bg-background/80 border border-border text-muted-foreground opacity-0 group-hover/img:opacity-100 transition-opacity">
          <ZoomIn className="w-3.5 h-3.5" />
        </span>
      </button>
      {open && <ImageLightbox src={src} alt={alt || "图片"} onClose={() => setOpen(false)} />}
    </>
  );
};

/** assistant-ui 图片 part 槽：agent 发回的图片块落在这里。 */
export const AcpImagePart: ImageMessagePartComponent = ({ image, filename }) => {
  if (!image || typeof image !== "string") return null;
  return <AcpImageView src={image} alt={typeof filename === "string" ? filename : undefined} />;
};

/** markdown 图片仅允许安全 scheme，其他一律退化为 alt 文本（防 XSS）。 */
export function isSafeMediaSrc(src: unknown): src is string {
  return typeof src === "string" && /^(https?:|data:|blob:)/i.test(src.trim());
}

export function isSafeLinkHref(href: unknown): href is string {
  return (
    typeof href === "string" && !/^\s*(javascript:|data:text\/html|vbscript:)/i.test(href)
  );
}
