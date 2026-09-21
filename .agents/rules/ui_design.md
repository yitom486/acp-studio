# ACP Studio UI 设计铁律（所有 AI 助手与贡献者必读）

本规则与 `.agents/rules/version_control.md` 同级，适用于本仓库 `src/` 下一切界面改动。
违反以下任何一条的 UI 提交必须打回重做。

## 一、风格：简约蓝灰科技风，禁止花哨

1. 只允许**蓝灰（blue-gray）单色系 + 单一 steel-blue 强调色**，走简约科技风。
2. 禁止蓝紫渐变（indigo/purple/pink）、禁止多色渐变背景、禁止彩色投影（colored shadow）。
3. 状态色只允许四种语义 token：`primary`（强调/进行中）、`success`（成功/已连接）、
   `warning`（待审批/警告）、`destructive`（危险/失败）。思考过程等中性面板用中性 token。

## 二、颜色只允许 CSS 变量，禁止字面调色板

1. 所有颜色必须来自 `src/index.css` 的 `:root` 变量，并经由 `tailwind.config.js`
   映射后的语义 token 使用：`background foreground card popover primary secondary
   muted accent success warning destructive border input ring`（及各自 `-foreground`）。
2. **JSX/TSX 的 className 中严禁出现字面调色板**，包括但不限于：
   `slate-* indigo-* purple-* pink-* emerald-* amber-* rose-* sky-* white black`
   以及十六进制颜色（如 `bg-[#070A12]`）。
3. 唯一例外：`magicui/animated-shiny-text.tsx` 内的微光扫过层（monochrome 效果，
   且已改用 `via-foreground` 变量实现）。
4. 自查命令（必须零命中，`whitespace-*` 等非颜色词除外）：
   ```bash
   rg --glob '*.tsx' '-(slate|indigo|purple|pink|emerald|amber|rose|sky|violet|fuchsia|cyan|teal|lime|orange|red|green|yellow|zinc|neutral|stone|gray)-\d|text-white|bg-white|border-white|text-black|bg-black|#[0-9a-fA-F]{3,6}\b' src
   ```

## 三、组件优先：shadcn / Magic UI，而不是手写 tailwind 动画

1. 基础组件只用 `src/components/ui/`（shadcn 模式：button badge card input skeleton）。
2. 动效只用 `src/components/magicui/`（BlurFade、AnimatedShinyText 等）与 framer-motion，
   禁止在业务组件里手写 keyframes / 渐变动画。
3. 新增动效需求先复用现有组件，确需新增时按官方实现原样移植到对应目录。

## 四、聊天内容必须富文本渲染

1. 助手消息必须经 `src/components/universal/Markdown.tsx` 渲染（GFM：列表/标题/
   粗体/代码块/表格/引用/链接），禁止 `whitespace-pre-wrap` 裸排。
2. 用户消息与系统动态保持纯文本，避免 `_` `*` 等字符被误解析。
