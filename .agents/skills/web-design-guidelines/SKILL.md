---
name: web-design-guidelines
description: Core visual and ergonomic standards for developer desktop applications. High-density layout, accessible contrast, typography hierarchy, and semantic theming.
---

# Web Design Guidelines — Developer Workbench Ergonomics

## 1. Typography Hierarchy
- System/Developer UI font stack for sans-serif: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`.
- Monospace font stack for all telemetry and code: `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`.
- Telemetry figures (tokens, time, currency, counts) must always use `font-mono tabular-nums`.

## 2. Color Contrast & Semantic Hierarchy
- **Canvas background**: `bg-background`
- **Surface / Card**: `bg-card` (elevated from background in dark; clean white in light)
- **Sub-containers / user bubble**: `bg-secondary` or `bg-secondary/70`
- **Muted areas / code fences**: `bg-muted`
- **Borders**: `border-border` (crisp contrast) or `border-border/60` (soft divider)
- **Primary vs Accent**: Primary is brand/action; Signal Amber (`text-warning` / `border-warning`) is active execution; Success (`text-success`) is ready/complete; Destructive (`text-destructive`) is error.

## 3. Light Mode Excellence
- Never use pure black (`#000000`) for text on light backgrounds; use deep ink (`hsl(222 47% 11%)`).
- Avoid blinding white cards on pure white background: use subtle 1px border (`border-border`) and soft contrast between `bg-background` and `bg-card`.
