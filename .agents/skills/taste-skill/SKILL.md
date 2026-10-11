---
name: taste-skill
description: Anti-slop frontend design framework. Enforces visual density, typography hierarchy, motion restraint, and eradicates generic AI-generated templates.
---

# Taste Skill — Anti-Slop Frontend Design Framework

## 1. Core Principles (The "Anti-AI-Slop" Manifesto)
AI models by default produce generic, template-driven UIs ("AI Slop") because they are trained on statistical averages. This skill enforces strict aesthetic and engineering standards to eliminate AI-slop completely.

### The Anti-Slop Banned List (Never Generate)
1. **NO Generic AI Hero Templates**: Banned: large centered Sparkles/Bot icons, `text-extrabold` marketing titles, 2-column or 3-column boilerplate feature cards with blue hover glow.
2. **NO Gratuitous Motion & Gimmicks**: Banned: `animate-fade-slide-in` on every message render, `AnimatedShinyText` sweeping highlights on static text, bouncing loading dots (`BouncingDots`), and pinging radar dots (`animate-ping`). Motion is reserved strictly for real-time streaming, interactive hover, and accordion transitions.
3. **NO Excessive Cards (De-card Everything)**: Do not wrap every paragraph, message, or tool result in a rounded card with borders and backdrop-blur. Content and typography must stand on their own hierarchy.
4. **NO Uniform Bubble Rounding**: Banned: arbitrary `rounded-2xl` everywhere. Use a strict, descending radius scale:
   - Panel / Viewport shell: `rounded-xl` (12px)
   - Secondary groups / cards: `rounded-lg` (8px)
   - Controls, buttons, inputs: `rounded-md` (6px)
   - Badges, pills, indicators: `rounded-sm` (4px)
5. **NO Literal Palette Classes in JSX**: Banned: `slate-*`, `zinc-*`, `blue-*`, `indigo-*`, `purple-*`, `text-white`, `text-black`, and `#hex`. Every color MUST use semantic tokens defined in CSS variables (`background`, `foreground`, `muted`, `card`, `secondary`, `border`, `primary`, `warning`, `destructive`, `success`).

## 2. Design Dials
Tune these three dials intentionally for every component:
- **Visual Density**: High (for IDE / developer workbenches). Prioritize visible telemetry, compact row heights, monospace tabular numbers, and zero-wasted vertical space.
- **Motion Intensity**: Restrained. Spring transitions (400 stiffness, 32 damping) for smooth re-ordering; no layout shifts on hover or appearance.
- **Color Accent**: Single Signal Accent. Keep the UI largely monochromatic / neutral. Use Signal Amber (`warning` token) exclusively for active/live runtime states (streaming, tool execution, pending approval).

## 3. Light & Dark Multi-Theme Discipline
- Never assume a dark background in component styling.
- All text must use `text-foreground` or `text-muted-foreground`.
- All containers must use `bg-background`, `bg-card`, or `bg-secondary`.
- All borders must use `border-border` or `border-border/60`.
- Verify every visual change in both dark mode and daylight (light) mode.
