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

### Changed
- **Studio 外壳重渲染修复**：`App.tsx` 原先用无选择器
  `useStudioStore()` 订阅整个 store，导致每个流式分片都重渲染整个布局。
  现改为 `useStudioShallow` 选择性订阅，`messages` 下移到真正渲染它的
  `ChatArea`（经 `useStudioMessages`）；持久化 effect 改为按需
  `getState()` 读取，不再订阅热路径。符合
  `.agents/rules/state_management.md` 的选择器订阅约定。

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
