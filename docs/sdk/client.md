# 用 SDK 写 ACP 客户端：TS + Rust

客户端 = 拉起 agent + 实现四个客户端能力 + 调 agent 方法。
JSON-RPC 本体一行不用写。

## TypeScript（`@agentclientprotocol/sdk`）

```bash
npm install @agentclientprotocol/sdk
```

### 1. 拉起子进程并接上传输层

```ts
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const proc = spawn("npx", ["-y", "@agentclientprotocol/codex-acp"], {
  stdio: ["pipe", "pipe", "pipe"],
});
const stream = acp.ndJsonStream(
  Writable.toWeb(proc.stdin),
  Readable.toWeb(proc.stdout)
);
// stderr 只打日志，绝不能混进 stdout（stdout 必须是纯 NDJSON）。
proc.stderr.on("data", (c) => process.stderr.write(`[agent] ${c}`));
```

### 2. 注册四个客户端能力 + 建长连接

```ts
const conn = acp
  .client({ name: "my-client" })
  // 权限审批：把请求转交给最终用户（弹窗/终端问答），不要在这里阻塞太久
  .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
    return askUser(ctx.params); // -> { outcome: { outcome: "selected", optionId } }
  })
  // 文件系统：真实读写（官方 example 只返回 mock，不能抄）
  .onRequest(acp.methods.client.fs.readTextFile, async (ctx) => {
    return { content: await fs.readFile(ctx.params.path, "utf8") };
  })
  .onRequest(acp.methods.client.fs.writeTextFile, async (ctx) => {
    await fs.writeFile(ctx.params.path, ctx.params.content);
    return {};
  })
  // 终端：为每个 terminalId 起一个真进程并保存输出（create/output/release/wait_for_exit/kill 五件套）
  .onRequest(acp.methods.client.terminal.create, async (ctx) => createTerminal(ctx.params))
  // elicitation：结构化问用户（form 按 requestedSchema 渲染表单）
  .onRequest(acp.methods.client.elicitation.create, async (ctx) => elicitUser(ctx.params))
  // 会话推送：agent 的全部输出都从这里来
  .onNotification(acp.methods.client.session.update, async (ctx) => {
    render(ctx.params.sessionId, ctx.params.update);
  })
  .connect(stream); // 长连接：conn.agent 可反复调用
```

> `connectWith(stream, async (ctx) => ...)` 是"用完即关"的作用域版本，
> 一次性脚本用它；常驻服务用 `connect()`。

### 3. 握手 → 建会话 → 发 prompt

```ts
const init = await conn.agent.request(acp.methods.agent.initialize, {
  protocolVersion: acp.PROTOCOL_VERSION,
  clientCapabilities: {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
    auth: { terminal: true },
    elicitation: { form: {}, url: {} },
  },
  clientInfo: { name: "my-client", version: "1.0.0" },
});
// init 里有 agentCapabilities / authMethods / agentInfo：
// - 按 loadSession / sessionCapabilities.* 决定调哪些会话方法
// - 按 promptCapabilities.image 决定能否发图片
// - authMethods 为空通常可直接建会话；报 -32000 再走 authenticate

const { sessionId } = await conn.agent.request(acp.methods.agent.session.new, {
  cwd: "/absolute/path",
  mcpServers: [],
});
await conn.agent.request(acp.methods.agent.session.prompt, {
  sessionId,
  prompt: [{ type: "text", text: "hello" }],
});
// session/update 会在 prompt 返回前陆续推送；结束看 stopReason。
// 中断：await conn.agent.notify(acp.methods.agent.session.cancel, { sessionId });
```

省力写法：`ctx.buildSession(cwd).withSession(async (session) => ...)`，
`session.prompt()` + `session.nextUpdate()` 循环读到 `stop` 为止，
见 SDK `examples/client.js`。

### 4. 错误码（不要字符串匹配）

agent 的失败以 `RequestError` 抛出，`code` 原样透传。
ACP 专用码（保留段 -32000 ~ -32099）：

| code | 含义 | 客户端动作 |
|---|---|---|
| `-32000` | Authentication required | 弹认证流程 |
| `-32800` | Request cancelled | 静默收尾，不是错误 |
| `-32002` | Resource not found | 提示路径无效 |
| `-32601` | Method not found | 该能力不可用，换降级路径 |
| `-32602` / `-32603` | Invalid params / Internal error | 打日志 + 报错 |

```ts
import { ACP_ERROR_AUTH_REQUIRED, isAuthRequiredError } from "./errors";
try {
  await conn.agent.request(acp.methods.agent.session.new, {...});
} catch (err) {
  if (isAuthRequiredError(err)) return startAuthFlow(); // 先判 -32000，再回退消息匹配
  throw err;
}
```

本项目对应实现：`server/universal/errors.ts`（网关侧）与
`src/lib/universal-api.ts` 的 `GatewayError`（前端侧，`authRequired` 标记 +
HTTP 401 由网关统一给出）。

## Rust（`agent-client-protocol`）

```toml
[dependencies]
agent-client-protocol = "1"
tokio = { version = "1", features = ["full"] }
```

### 客户端（现代 builder，docs.rs 实测可用写法）

```rust
use agent_client_protocol::Client;
use agent_client_protocol::schema::{ProtocolVersion, v1::InitializeRequest};

Client::builder()
    .name("my-client")
    .connect_with(transport, async |cx| {
        // 1. 握手
        cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
            .block_task().await?;
        // 2. 建会话 + 发 prompt，读到结束
        cx.build_session_cwd()?
            .block_task()
            .run_until(async |mut session| {
                session.send_prompt("What is 2 + 2?")?;
                let response = session.read_to_string().await?;
                println!("{response}");
                Ok(())
            })
            .await
    })
    .await
```

要点（与 TS 一一对应）：

- 传 Pipe：子进程 `Command` 配 `Stdio::piped()`，stdin/stdout 接 transport
  （旧示例用 `ClientSideConnection::new(client, outgoing, incoming, spawner)`，
  语义相同，builder 是新写法）。
- 四个客户端能力通过实现 `Client` trait 提供（`request_permission` /
  `session_update` / 文件读写 / terminal 五件套），与 TS 的 `onRequest` 等价。
- 更多模式（MCP 接入、proxy、conductor 编排）看官方 cookbook
 （`agent-client-protocol-cookbook`）与示例客户端 `yopo`。

## checklist（对照本项目网关自查）

- [ ] stderr 与 stdout 严格分离（stdout 只走 NDJSON）
- [ ] 四个客户端能力全部实现（permission 必须可超时/可取消）
- [ ] `initialize` 后按 capabilities 裁剪调用，不过度假设
- [ ] 错误走 code（-32000/-32800）分流，不用正则匹配 message
- [ ] `session/cancel` 用 notify（无响应），并顺手取消挂起的 permission
