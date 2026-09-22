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

## 四、线程持久化与自动续聊（`src/lib/threads.ts` + store 线程镜像）

1. 对话记录按 agent 隔离存 `localStorage`（`acp_threads_v1`，40 线程/200 条/2 万字截断，空线程丢弃，`isStreaming` 落盘前冻结）。读写只经 `threads.ts` 纯函数，便于单测。
2. 打开即渲染缓存（零网络），重连后用缓存里的 `sessionId` 调 `session/resume` 续模型上下文；缓存为空才用 `session/load` 回放，避免气泡重复。
3. `sessionId` 绝不跨 agent：写入只发生在当前 agent 活跃时（`bindThreadSession` 校验归属），读取只取本 agent 最新线程；`resume` 失败必须落一条 system 消息并清绑定（可见降级，见 no-silent-fallbacks.md），下一次 prompt 惰性建新会话。
4. 快照节流 1500ms trailing + 会话事件即时写；`sessionId` 等 live 视图保持原样，线程只做镜像，不替代。
