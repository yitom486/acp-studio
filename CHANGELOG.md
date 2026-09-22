# Changelog

本文件由 `bun run release:patch`（及 minor/major 变体）自动维护：
发版时把 `Unreleased` 小节归档为新版本，手工只管往 `Unreleased` 里加条目。
版本号规则见 `.agents/rules/version_control.md`，事实源为 `package.json`。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
日期为发版当日（UTC+8）。

## [Unreleased]

### Added
<!-- 日常开发把条目写在这里（- 开头一行一条），发版时自动归档；注释行不计入归档 -->
- Studio store 新增 `useStudioShallow` / `useStudioMessages`：选择性订阅
  视图状态，刻意排除 `messages`（流式热路径字段）。
- README 新增“桥接库三源版本对齐”小节：根 `package.json ^x.y.z` /
  `scratch` 子模组 commit pin / runner 缓存 `@latest` 三源语义与对齐策略
  （发版前 `bun update` + 锁定；实际运行版本以 `initialize` 的
  `agentInfo.version` 为准）。
- 新增 `tests/universal/presets-runner.test.ts`：断言
  `antigravity-stdio` 解析为 runner 命令（含 `@yitom/agy-acp-map@latest`、
  不含 `.exe`），codex 回归守卫同在。

### Changed
- **Studio 外壳重渲染修复**：`App.tsx` 原先用无选择器
  `useStudioStore()` 订阅整个 store，导致每个流式分片都重渲染整个布局。
  现改为 `useStudioShallow` 选择性订阅，`messages` 下移到真正渲染它的
  `ChatArea`（经 `useStudioMessages`）；持久化 effect 改为按需
  `getState()` 读取，不再订阅热路径。符合
  `.agents/rules/state_management.md` 的选择器订阅约定。
- **tsconfig 渐进严格化第一步**：保持 `strict:false`，新增
  `"strictNullChecks": true`（基线 `bunx tsc --noEmit` 0 错误，试开增量
  0 错误 <20 阈值）；全量 `strict:true` 暂缓（残留 4 个 TS7022
  于 `src/lib/universal-api.ts` 回放聚合），渐进路线
  （session→SSE→安装→权限/elicitation→文件终端）已写进 `tsconfig.json` 注释。
- **README 过期引用修正**：`server/acp-stdio.ts`（不存在）改为
  `server/universal/` + `server/index.ts` / `server/node.ts` 与桥自带
  `sdk-server.ts`（`bun run acp:stdio` 真入口）；`src/lib/sse-client.ts`
  改为 `src/lib/universal-api.ts`；`server/bridge/agyBridge.ts` 改为
  `server/universal/*`；核心库徽章 `v0.1.3` 改为 `v0.1.6`
  （以根 `package.json` 为准）；测试徽章改为“74 Vitest (universal)”
  并注明黑盒需本地 `bun`；目录结构小节与真实布局对齐
  （`server/universal`、`desktop`、`tests/universal`）。
- **agy 切 codex 式 runner**：`antigravity-stdio` 不再 spawn 86MB
  managed exe，改为 `bunx @yitom/agy-acp-map@latest` 直起 thin JS
  `bin.js`（与 codex 预设同构）；`registry.ts` 删除 exe override
  分支；`agent-installer.ts` 的 `MANAGED_AGENTS` 清空为通用空表，
  bridge/exe 解析（`bridgeSource` / `resolveBridgeExe` /
  dev-checkout）与 `resetHeadlessLauncherCache` 一并退役；
  `routes.ts` 删除 `/bridge-source`、`/install-state`、`/install`、
  `/install/:jobId` 端点；前端删除安装徽标/安装按钮/bridge 切换/
  自动更新开关整条线（`App`、`Sidebar`、`universal-api`）；
  `desktop/main.ts` 删除 `agy-headless.exe` 打包挂载；
  `acp:stdio` 脚本改为 `bunx @yitom/agy-acp-map@latest`；
  依赖升 `@yitom/agy-acp-map ^0.1.13`（thin npm，无大 exe）；
  `no-silent-fallbacks` 规则同步到 runner 语义（本地桥联调改走
  自定义 profile 覆盖）。
- **历史恢复丢回答修复**：`handleSend` 全程不调 `snapshotThread`，
  trailing 自动快照只在会话/线程切换后触发，流式完成后再无落盘，
  reload 回来只剩用户问。现改为每轮结束（成功/失败/abort）立即
  `snapshotThread`；`freezeMessage` 落盘只保留最终答案（+thought），
  tool 调用与结果展示层可见、永不落盘。
- **连接即 resume**：`handleConnect` 的 resume 分支之前丢弃
  `session/resume` 返回的 modes/models/config，模型选择器空到首问；
  现回应用 + `applyDefaultConfigOptions`；`handleOpenSession` 在
  load 回放成功后显式 `resume` 绑定（失败只 warn，不阻断已绑定的历史）。
  编排归 Studio，桥只负责 ACP 协议动作。
- **标题**：`index.html` 改为自有标题 `ACP Studio`。
- **桥 0.1.14（reload 对等）**：取消/失败轮也落半截文本（`partial` 标记），
  `session/load` 照常回放；子模组 pin 到 `v0.1.14`，CI 新增桥历史测试门禁
  （`history-partial-persist` + `session-history`）；runner `@latest`
  发布后自动跟进（本地 `package.json` 基线保持 `^0.1.13`，代码内无引用）。

### Fixed
- **静默错误 loud 化**（`no-silent-fallbacks` / `error_handling`）：
  `server/universal/registry.ts` 自定义 agents 文件解析/持久化失败由静默
  `return []` 改为 `console.warn` 带文件路径 + 原因（仍返回 `[]` 保活网关）；
  `server/universal/presets.ts` 的 `ACP_AGENTS_JSON` 损坏同样 `console.warn`
  保活；`src/App.tsx` 工作区默认值、配置恢复链、一次性会话清理的裸
  `.catch(()=>{})` / 空 `catch` 改为 `console.warn` / `console.debug`
  （逻辑不变）；剪贴板复制失败改 `console.debug`；
  `findRunnerBin` 逐项试探补 deterministically 无害注释。
  可预期清理失败（disconnect/close）允许忽略但均已留痕；
  本轮横切另含安全加固、agent 异步按需安装、SSE 发送互斥、前端懒加载拆分，
  细节见各专项条目（此处仅汇总，不编造版本号）。

## [0.1.0] - 2026-09-22

首个基线版本（此前 `package.json` 误标 1.0.0，回正为 0.1.0 起步）。

### Added
- 通用 ACP v1 网关（`server/universal`）：多 agent stdio 管理、
  permission/fs/terminal/elicitation 客户端能力、authStatus 透出、
  fork/providers 透传、load 回放收集、HTTP/SSE 接口。
- ACP Studio Web 工作台：Agents/Sessions 侧边栏、模型库浏览器
  （模型/思考等级/权限选择与发现）、slash 联想、附件（拖拽/粘贴/预览）、
  Markdown 富文本、git 变更查看（前后对照 + 统一 diff）、
  providers 面板、elicitation 表单、权限审批流。
- Hono 网关（Bun/Node 双入口）与 Electron 桌面壳（进程内网关、
  打包配置、GitHub CI/Release 工作流）。
- 前端工程化：zustand 客户端状态、TanStack Query 服务端状态、
  shadcn + Magic UI 组件体系、蓝灰变量主题、集中错误处理
 （error-bus/ErrorBoundary/ErrorToast）。
- 文档：`docs/sdk`（客户端/服务端写法，TS+Rust）、agent 规则
 （版本/ UI 设计/错误处理/状态管理）。

[Unreleased]: https://github.com/yitom486/acp-studio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yitom486/acp-studio/releases/tag/v0.1.0
