# 用 SDK 写 ACP 客户端与服务端（TS + Rust）

本目录回答一个问题：**ACP 的 JSON-RPC 对接到底要不要手写？**

答案：不用。协议层（组帧、id 分配、pending 映射、参数校验、路由）全部由官方
SDK 承担；你只需要实现两套**业务接口**。本目录分两篇讲透：

- [客户端篇](./client.md) — 拉起 agent 子进程、握手、建会话、发 prompt、
  实现 permission / fs / terminal / elicitation 四个客户端能力。
- [服务端篇](./server.md) — 实现 `initialize` / `session/new` / `session/prompt`
  等 agent 方法，把自家模型/工具接进 ACP 生态。

## SDK 版图（对照官方文档核对，2026）

| 语言 | 包 | 状态 |
|---|---|---|
| TypeScript | `@agentclientprotocol/sdk` | 1.x 稳定，本项目在用 |
| Rust | `agent-client-protocol`（crates.io） | 1.0，Zed 编辑器在用 |
| Python | `agent-client-protocol`（pip） | 官方维护，Pydantic + 异步基类 |
| Kotlin / Java | Maven（JVM） | 可用，Kotlin 仍是 SNAPSHOT |
| 社区 | Go（6 个实现最多）、Swift、.NET、C++、Dart 等 | 官网 registry 收录 |

## 分界线（本项目实践）

| SDK 负责 | 你负责（产品逻辑） |
|---|---|
| JSON-RPC 组帧/解析、id、超时 | 拉起/杀掉 agent 子进程、管理多 agent |
| 方法名常量与类型（`methods.agent.session.new` 等） | permission/elicitation 转发给最终用户（弹窗/终端问答） |
| 参数 schema 校验（发收双向） | fs 真实读写、terminal 真进程托管 |
| 错误码透传（`RequestError.code`，如认证 `-32000`） | HTTP/SSE 网关、会话回放收集、模型目录聚合 |

对照实现：客户端看 `server/universal/AgentConnection.ts`，
服务端看 `server/acp-stdio.ts`（底层 `@yitom/agy-acp-map` 同样基于 TS SDK）。
反面例子：本项目删掉的 `server/acp/client.ts`（手写 pending map，已无残留，
`agyBridge` 的 process 模式一并移除——仓库里不再有任何手拼的 JSON-RPC）。

> experimental 说明：SDK 另有 `experimental/v2`（TS）/ `.v2()`（Rust）
> 对应草案协议 v2，本项目 v1 先行，v2 再议。
