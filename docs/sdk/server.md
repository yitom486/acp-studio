# 用 SDK 写 ACP 服务端：TS + Rust

服务端（agent）= 实现握手/建会话/接 prompt 三个方法 + 主动推更新。
参数校验、错误转译、路由全部 SDK 包办，handler 只写业务。

## TypeScript（`@agentclientprotocol/sdk`）

```ts
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const app = acp
  .agent({ name: "my-agent" })
  .onRequest(acp.methods.agent.initialize, async (ctx) => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      sessionCapabilities: { resume: {}, list: {}, close: {}, delete: {} },
      mcpCapabilities: { http: true },
    },
    authMethods: [{ id: "api-key", name: "API Key", description: "..." }],
    agentInfo: { name: "my-agent", title: "My Agent", version: "1.0.0" },
  }))
  .onRequest(acp.methods.agent.session.new, async (ctx) => {
    const sessionId = createSession(ctx.params.cwd); // 你的业务
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
    // ctx.params: { sessionId, prompt: ContentBlock[] }（已按 schema 校验）
    // ctx.client：回调用客户端能力；ctx.signal：取消信号
    // 用 ctx.client.request(...) 调客户端能力，用 ctx.client.notify(...) 推更新：
    await ctx.client.notify(acp.methods.client.session.update, {
      sessionId: ctx.params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" },
      },
    });
    // 需要授权：await ctx.client.request(session.requestPermission, {...})
    // 需要读文件：await ctx.client.request(fs.readTextFile, { sessionId, path })
    return { stopReason: "end_turn" }; // end_turn | cancelled | max_tokens | refusal
  });

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin)
);
app.connect(stream); // 常驻；connectWith 用于 scoped 场景
```

SDK 替你做的事：

1. **入参按 schema 自动校验**，非法直接回 `Invalid params`（-32602），到不了 handler。
2. **handler 抛错自动转 JSON-RPC error**；想定点报错就抛
   `new acp.RequestError(code, message)`（如认证缺失抛 -32000，
   对端收到的是结构化错误而不是崩掉连接）。
3. **方法名即类型**：`acp.methods.agent.*` 常量与 params/response 类型绑定，
   写错方法名或参数形状在 `tsc` 阶段就拦下。
4. 可选方法（`session/load`、`session/set_mode`、`logout`…）按需注册，
   没注册 + 没广播 capability = 客户端不会调。

本项目对照：`server/acp-stdio.ts` 就是这个骨架
（`createDualAcpApp(service)` 底层同样基于 TS SDK 的 agent 侧）。

## Rust（`agent-client-protocol`）

```rust
use agent_client_protocol::{Agent, schema::{ProtocolVersion, v1}};

// 实现 Agent trait：initialize / new_session / prompt 等
// （完整签名见 docs.rs，模式与 TS 的 onRequest 一一对应）
Agent::builder()
    .on_receive_request(
        async |initialize: v1::InitializeRequest, responder, _cx| {
            responder.respond(v1::InitializeResponse::new(
                initialize.protocol_version, // 版本协商：回客户端支持的版本
            ))
        },
        agent_client_protocol::on_receive_request!(),
    )
    // .on_receive_request(prompt_handler, ...) // 按需继续注册
    .connect_to(client_transport)
    .await?;
```

要点：

- `Agent.builder()`（稳定 v1）与 `Agent.v2()`（草案 v2）是两套入口，
  不要混用；双版本兼容看官方 `protocol_router` 模式。
- 回包必须经 `responder.respond(...)`，与 TS 里 `return {...}` 等价。
- 传 Pipe、子进程/std I/O 接法与客户端篇对称；
  完整可跑示例看官方 `examples/agent.rs`。
- 进阶：`Proxy.builder()` + conductor 可在不改 agent 的前提下扩展行为；
  可复用组件与测试脚手架在 cookbook / `agent-client-protocol-test`。

## 认证与能力协商（两端都要懂）

1. `initialize` 响应里广播 `authMethods`（`agent` 自处理 / `terminal` 另起交互进程）。
2. 需要登录的请求直接回 -32000，客户端据此弹认证页（见客户端篇错误码表）。
3. `logout` 只有广播了 `auth.logout` 能力才能被调；调用后已有会话的行为由
   agent 自定，客户端必须能接受后续操作继续报 -32000。

## checklist

- [ ] `initialize` 只广播真正实现的能力，不超前承诺
- [ ] 所有 handler 入参相信 SDK 校验，只写业务校验
- [ ] 错误用 `RequestError(code, …)` 定点抛，不抛裸 Error
- [ ] `session/prompt` 被 cancel 后必须回 `cancelled` 而不是抛异常
      （否则客户端会把"用户取消"当报错弹窗）
- [ ] 日志走 stderr，stdout 只留 NDJSON（stdio 模式铁律）
