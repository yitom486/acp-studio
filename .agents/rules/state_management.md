# 状态管理规范（zustand + TanStack Query）

客户端状态与服务端状态必须分开存放，禁止在 `App.tsx` 里堆 `useState`
与手写轮询。 transients（AbortController、StrictMode 防重 key）可用 `useRef`。

## 一、客户端状态 → zustand（`src/stores/useStudioStore.ts`）

1. 所有 UI 与会话视图状态（activeAgentId、sessionId、modes/models/config、
   messages、input、attachments、pending 审批、各类弹窗开关、authOk）
   全部进 store，组件用选择器订阅：`useStudioStore((s) => s.messages)`。
2. 异步编排里**禁止闭包读 state**：一律经 `useStudioStore.getState()` 现读，
   写经 store action（`appendMessage` / `patchMessage` / `applySessionResult` …）。
3. 新增共享状态时同步加 action；纯派生值（capabilities 判定、当前 agent）
   在消费处现算，禁止 duplicative 镜像 state。
4. 消息更新必须按 id 定向 patch，禁止整树重建导致流式閃爍。

## 二、服务端状态 → TanStack Query（`src/lib/acp-queries.ts`）

1. `agents` 列表、`sessions` 列表只能经 `useAgentsQuery` / `useSessionsQuery`
   获取，key 统一收敛在 `acpKeys`。轮询用 `refetchInterval`，禁止手写
   `setInterval` 拉数据。
2. 写操作成功后用 `invalidateAgents` / `invalidateSessions` 失效对应 key，
   禁止手动 `setSessions([...])` 拼凑服务端视图。
3. QueryClient 全局配置：`staleTime 5s`、`retry 1`、
   `refetchOnWindowFocus false`（见 `src/main.tsx`）。
4. SSE 流式传输不进 Query：`consumeUniversalChat` 回调里写 store。

## 三、传输层保持哑巴（`src/lib/universal-api.ts`）

fetch/SSE 封装只做协议与解析，不持有任何状态；
`buildTranscriptFromReplay`、`parseModelId`、`findConfigOption` 等纯函数
就近测试（见 `tests/universal/`）。
