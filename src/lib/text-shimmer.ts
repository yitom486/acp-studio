import type { CSSProperties } from "react";

// The reduced-motion rule travels with the component. app/globals.css calms CSS
// animation globally, but the registry bundles imports only, so an installed
// copy never receives that reset.
//
// `!important` because the sweep is an inline style, which outranks a plain rule
// in a media query. It selects a marker class carried by TEXT_SHIMMER_CLASS_NAME
// so it also reaches consumers that build their own span out of these exports.
export const TEXT_SHIMMER_KEYFRAMES = `
@keyframes beui-text-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.beui-text-shimmer {
  background-image: linear-gradient(110deg, hsl(var(--muted-foreground)) 30%, hsl(var(--foreground)) 50%, hsl(var(--muted-foreground)) 70%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  display: inline-block;
}
@media (prefers-reduced-motion: reduce) {
  .beui-text-shimmer {
    animation: none !important;
    background-image: none !important;
    -webkit-text-fill-color: currentColor !important;
    color: hsl(var(--muted-foreground)) !important;
  }
}
`;

export const TEXT_SHIMMER_CLASS_NAME = "beui-text-shimmer";

export function textShimmerStyle(duration: number): CSSProperties {
  return {
    animation: `beui-text-shimmer ${duration}s linear infinite`,
  };
}
