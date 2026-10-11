# ACP Studio — UI Redesign Brief

Target: an almost-full visual redesign of the chat workbench to remove AI-slop.
Status: direction + constraints live here. **Mandatory skills** (installed globally
in `~/.agents/skills`, mirrored to `.claude` / `.codex`): `frontend-design`
(director, improved local version), `redesign-existing-projects` (diagnostic
checklist), `web-design-guidelines` (audit).

## Brief

- **Subject**: desktop AI-agent workbench (Electron). Chat with coding agents,
  tool-call audit trail, sessions sidebar, terminal, git diff review.
- **Audience**: developers living in it daily, often in hour-long sessions.
- **Job**: legibility under load. Density and predictability beat decoration.

## Stack facts (do not regress)

- React 19.3, Tailwind CSS v4 CSS-first (`@theme inline` tokens in
  `src/index.css`; NO `tailwind.config.js`; build via `@tailwindcss/vite`).
  v4 notes: `bg-linear-*` (not `bg-gradient-*`), bare `border` keeps v3 look
  via `--default-border-color`, button cursor must be explicit.
- Chat renders on **assistant-ui primitives** (`Thread/Viewport/Messages/Parts`,
  `ExternalStoreRuntime` over the zustand ACP store). Do not replace the
  runtime or the ACP protocol layer for visual reasons.
- State: zustand (client) + TanStack Query (server lists). Reads → Query,
  writes → mutation + invalidate, streams stay imperative.
- **Four data-themes must keep working**: `dark / oled / dim / light`
  (`data-theme` vars in `src/index.css`). Verify any visual change in at
  least dark + light.
- Density must not drop. No functionality breaks. No new runtime dependency
  without checking `package.json` first.

## Direction (agreed)

1. De-card assistant messages → 2px signal rail + spacing hierarchy.
2. One accent (signal amber for agent/live states); user bubble desaturated
   slate; semantic red stays.
3. Mono rises to first-class (timestamps, token counts, tool titles, status rows).
4. Remove per-message entrance animation; motion only for streaming,
   expand/collapse, hover.
5. Radius by hierarchy (12/8/6), never uniform.
6. Composer becomes a slash-first command deck.

## Gates (every piece)

- [ ] `bunx tsc --noEmit` clean, full `vitest` suite green, `vite build` ok
- [ ] Screenshot reviewed (welcome, streaming, tool group, composer)
- [ ] dark + light theme checked
- [ ] No layout shift from hover/appear chrome (absolute overlay or fixed slot
      + opacity only — never mount/unmount in flow)
- [ ] Small, reviewable diffs; one component area per change
