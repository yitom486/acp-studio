---
name: redesign-existing-projects
description: Diagnostic and surgical redesign workflow for refactoring existing codebases. Preserves state invariants and protocols while completely upgrading visual aesthetics.
---

# Redesign Existing Projects — Surgical Refactoring Workflow

## 1. Diagnostic Step
Before touching any code:
1. Identify the "functional bone" (features, invariants, protocol bindings, telemetry, stores). These MUST NOT be broken.
2. Identify the "template skin" (superficial AI templates, generic cards, literal colors, bloated radii, excessive badges).
3. Check the theme matrix: verify how current tokens render in `dark`, `oled`, `dim`, and `light`.

## 2. Refactoring Gates
Every component change must satisfy:
- Zero loss of existing capabilities (e.g. branch navigation, copy button, edit resend, timing telemetry, error banners).
- Zero layout shift: dynamic actions (copy, edit, fork) must occupy a fixed slot with opacity transition or absolute overlay — NEVER push or squeeze surrounding text.
- TypeScript compiler clean (`bunx tsc --noEmit`).
- Unit tests green (`bun run test`).
- Semantic tokens only: no literal Tailwind colors.
