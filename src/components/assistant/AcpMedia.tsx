import React, { useEffect, useState } from "react";
import { Download, ImageOff, X, ZoomIn } from "lucide-react";
import type { ImageMessagePartComponent } from "@assistant-ui/react";

/**
 * 聊天图片：agent 图片 part 与 markdown 图片共用。
 * 缩略图 + 点击灯箱（原图/下载/Escape 关闭）；SVG 以 <img> 呈现，
 * 脚本不执行，与浏览器原生语义一致，安全。
 */

const ImageLightbox: React.FC<{ src: string; alt: string; onClose: () => void }> = ({
  src,
  alt,
  onClose,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-md p-4 md:p-8 animate-fade-slide-in"
      onClick={onClose}
      role="dialog"
      aria-label={alt || "图片预览"}
    >
      <div
        className="relative max-w-full max-h-full flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt || "图片"}
          className="max-w-full max-h-[85vh] object-contain rounded-xl border border-border shadow-2xl"
        />
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {/^(data:|blob:)/.test(src) && (
            <a
              href={src}
              download
              onClick={(e) => e.stopPropagation()}
              className="p-2 rounded-full bg-card/90 border border-border text-muted-foreground hover:text-foreground transition-colors"
              title="下载原图"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-card/90 border border-border text-muted-foreground hover:text-foreground transition-colors"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
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
