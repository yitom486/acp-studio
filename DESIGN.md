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
7. **Unified theme transition system**: zero hardcoded color switch durations;
   synchronized CSS design tokens with lockstep execution.

## Unified Theme Transition System (统一明暗主题切换动效规范)

### 1. 现状痛点与割裂感根因
此前不同组件在明暗主题切换时存在明显的**视觉撕裂感**：
* 部分组件硬编码了 `transition-colors duration-150`，部分硬编码了 `duration-300`，还有部分组件完全没有过渡属性（瞬时突变）；
* 导致切换主题瞬间，父容器背景已变浅，子组件文字却在半秒后才渐变完成，或者边框先变深、背景后变深，组件间节拍不一，如同画面撕裂。

### 2. 设计令牌 (CSS Design Tokens - Single Source of Truth)
所有主题切换的动作与时间**严禁在具体组件中硬编码**，统一收敛在 `src/index.css` 的 `:root` 变量中：
```css
:root {
  /* 统一切换时长：200ms（利落干脆，杜绝拖泥带水，兼具丝滑感） */
  --theme-transition-duration: 200ms;
  /* 统一缓动曲线：自然流畅的标准减速贝塞尔 */
  --theme-transition-timing: cubic-bezier(0.4, 0, 0.2, 1);
  /* 统一联动的视觉通道 */
  --theme-transition-properties: color, background-color, border-color, text-decoration-color, fill, stroke, box-shadow;
}
```

### 3. 全局锁步执行机制 (Synchronized Transition Lock)
由 `useThemeStore.ts` 统一调度，绝不在各个组件写分散的 transition 逻辑：
1. **用户触发切换时**：
   - `applyThemeToDOM(themeId, true)` 动态读取 CSS 变量 `--theme-transition-duration`；
   - 为根节点添加 `html.theme-transitioning` 类；
   - 全站所有组件（背景、边框、文字、图标、阴影）在 CSS 规则强约束下以完全一致的 **200ms / cubic-bezier(0.4, 0, 0.2, 1)** 节拍完成过渡，彻底消灭色彩断层；
   - 过渡结束后（`durationMs + 30ms`）精准移除该类，恢复各个按钮与卡片原生的 hover/focus 快速响应微交互，性能与体验零开销。
2. **冷启动首屏渲染时**：
   - `applyThemeToDOM(themeId, false)` 不挂载过渡类，瞬时呈现保存的主题，杜绝黑/白屏拉扯闪烁。

### 4. 桌面端原生控制栏（Window Controls Overlay）对齐规范
* **色值 100% 咬合**：标题栏 CSS 变量 `--titlebar-bg`（纯白 `#ffffff` 或 暗黑 `#0b0e14`）必须与原生系统遮罩 `overlayColor` 完全一致；
* **实体无透底**：TitleBar 严禁使用半透明修饰符（如 `bg-card/90`），必须使用纯色实体 `bg-[hsl(var(--titlebar-bg))]`，避免 Electron 窗口底色漏底；
* **主进程持久化**：主进程通过 `theme-overlay.json` 记忆最后一次主题色，冷启动开窗直接以此颜色创建原生遮罩，消除开窗黑块。

### 5. 无障碍减弱动效 (Accessibility)
严格遵循系统辅助功能规范：
```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --theme-transition-duration: 0ms;
  }
  html.theme-transitioning,
  html.theme-transitioning * {
    transition: none !important;
  }
}
```

## Gates (every piece)

- [ ] `bunx tsc --noEmit` clean, full `vitest` suite green, `vite build` ok
- [ ] Screenshot reviewed (welcome, streaming, tool group, composer)
- [ ] dark + light theme checked
- [ ] No layout shift from hover/appear chrome (absolute overlay or fixed slot
      + opacity only — never mount/unmount in flow)
- [ ] Small, reviewable diffs; one component area per change

