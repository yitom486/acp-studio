# 前端错误集中处理规范

所有运行时错误必须能被用户在界面内看到，禁止只打 `console` 静默吞掉。

## 一、三层结构

1. **错误总线**（`src/lib/error-bus.ts`）：唯一入口 `reportError(source, err)`，
   右下角 `ErrorToast` 统一展示（展开堆栈、复制、忽略/清空）。
2. **全局捕获**（`installGlobalErrorCapture`，`main.tsx` 调用一次）：
   `window.onerror` 与 `unhandledrejection` 自动进总线。
3. **崩溃兜底**（`src/components/ErrorBoundary.tsx`）：包住 `<App/>`，
   渲染崩溃时显示可重试的错误屏，并把堆栈送进总线。
   `ErrorToast` 挂在 Boundary 之外，树崩了 toast 依然可见。

## 二、业务错误归属

1. 请求级错误（connect / session / permission / elicitation）：就近提示
  （`alert` 或行内错误气泡），由调用方负责，不强制进总线，避免双重打扰。
2. 未捕获的异常与 Promise 拒绝：禁止裸 `catch {}`，要么就近处理并提示用户，
   要么 `reportError` 送总线。`catch { // ignore }` 只允许出现在 deterministically
   无害的位置（关闭已关的流、清理定时器），且必须写明原因注释。
3. 模块加载期失败（如 vite import 解析失败）发生在代码运行之前，
   应用内接不住：靠 `bunx tsc --noEmit` 与 `bun run build` 在提交前拦截。

## 三、UI 约束（沿用 ui_design.md）

错误 UI 同样只允许变量色：`destructive` 强调、`card` 底、`border` 边框、
`muted-foreground` 次要文字；动效只用 magicui 组件（BlurFade）。
