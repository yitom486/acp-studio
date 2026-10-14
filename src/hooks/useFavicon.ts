"use client";

import { useCallback, useState } from "react";
import { getFaviconUrl } from "@/lib/favicon";

/**
 * Resolves a site favicon and drops it once it is known to be unusable, so
 * callers can draw their own glyph instead of a broken image.
 */
export function useFavicon(url?: string) {
  const resolved = url ? getFaviconUrl(url) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = resolved && resolved !== failedSrc ? resolved : null;

  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !src) return;

      let released = false;
      if (typeof img.decode === "function") {
        img.decode().catch(() => {
          if (!released) setFailedSrc(src);
        });
      }

      return () => {
        released = true;
      };
    },
    [src],
  );

  return { src, ref };
}
