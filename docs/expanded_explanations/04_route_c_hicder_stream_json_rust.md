# 社区路线 C：hicder/agy-acp 的原生 stream-json + Rust Stdio 架构

本文根据当前 scratch/repos/hicder-acp 的代码，说明这个项目为什么在三条路线中最接近“正确的事件流适配”，以及它仍然存在的工程限制。

## 1. 一句话概括

这个项目不使用 PTY，也不读取 SQLite，而是直接消费 agy 的机器可读 stdout：

~~~text
Zed / ACP Host
      ↓ Stdio JSON-RPC
Rust agy-acp
      ↓ tokio::process::Command
agy --output-format stream-json
      ↓ stdout NDJSON
StreamProcessor
      ↓
ACP session/update
~~~

它把 agy 的每一行 JSON 当作事件，而不是把终端画面或数据库当作中间协议。

这也是它最重要的架构优势。

## 2. 项目结构

这是一个单独的 Rust crate，主要文件如下：

| 文件 | 作用 |
|---|---|
| src/main.rs | Stdio JSON-RPC 主循环和请求分发 |
| src/adapter.rs | ACP 会话、启动 agy、取消和状态持久化 |
| src/streaming.rs | 解析 NDJSON，处理文本、思考、工具和 result |
| src/tools.rs | 工具类型、路径、输入输出和内容转换 |
| src/types.rs | JSON-RPC、SessionStore 和会话类型 |
| src/tests.rs | 单元测试 |
| Cargo.toml | Rust、Tokio、Serde、fs2 等依赖 |

依赖相对集中：

- tokio：异步进程、I/O 和任务；
- serde / serde_json：JSON-RPC 和 stream-json；
- fs2：状态文件锁；
- uuid：session ID；
- clap：命令行参数。

它没有使用 node-pty、SQLite 驱动或 protobuf 数据库 decoder。

## 3. Stdio JSON-RPC 主循环

src/main.rs 启动后做三件事：

1. 用线程持续读取 stdin 的 JSON 行；
2. 用 Tokio 任务处理请求；
3. 将 ACP 响应和 session/update 通知写回 stdout。

支持的主要请求包括：

- initialize；
- session/new；
- session/load；
- session/resume；
- session/prompt；
- session/cancel；
- session/set_model；
- session/setConfigOption。

这是一种直接、容易部署的 ACP Stdio 服务形态：Zed 只需要启动这个 Rust 可执行文件，并通过 stdin/stdout 发送 JSON-RPC。

## 4. prompt 的执行路径

当收到 session/prompt 时，Adapter::handle_session_prompt() 会：

1. 读取 ACP sessionId；
2. 提取 prompt 文本；
3. 从当前会话读取 conversation_id 和模型；
4. 构造 agy 参数；
5. 启动 agy 子进程；
6. 异步读取 stdout；
7. 把每一行交给 StreamProcessor；
8. 将生成的 ACP notification 写回 stdout；
9. 等待 agy 退出；
10. 持久化新的 conversation 绑定；
11. 返回 stopReason。

典型命令形态是：

~~~text
agy
  --add-dir <working-dir>
  --output-format stream-json
  [--conversation <id>]
  [--model <id>]
  -p <prompt>
~~~

代码同时把 stderr 单独读取，不让错误文本污染 stdout 的 JSON 协议通道。

## 5. stream-json 的解析机制

src/streaming.rs 定义了几个核心事件结构：

~~~text
StreamEvent
  ├── event
  ├── conversation_id
  ├── step_update
  └── result
~~~

其中 step_update 可能包含：

- step_index；
- state；
- step_type；
- tool_name；
- text_delta；
- thought_delta；
- tool_info；
- subagent_info。

### 5.1 每行解析

process_line() 的处理方式很直接：

~~~text
读取一行
  ↓
trim
  ↓
serde_json::from_str
  ↓
根据 event 分派
~~~

无法解析的行会被忽略，这可以避免一条异常输出直接让整个适配器崩溃，但也可能隐藏上游协议发生变化的问题。

### 5.2 绑定 conversation ID

init、step_update 或 result 中只要出现 conversation_id，处理器就会绑定它：

~~~text
第一次看到 conversation_id
        ↓
绑定到当前 ACP session
        ↓
后续 prompt 使用 --conversation <id>
~~~

这样多轮对话不需要读取 Google 的数据库来恢复上下文。

### 5.3 Agent 文本增量

处理器按 step_index 保存已经收到的文本，并记录已经向 ACP 输出的字符数量。

如果同一个 step 的文本继续增长，它只发送新增部分：

~~~text
第一次：The file contains
第二次：The file contains three modules
输出：                         three modules
~~~

这与实时流式 UI 的需求非常匹配。

### 5.4 思考流

如果事件包含 thought_delta，代码会输出：

~~~json
{
  "sessionUpdate": "agent_thought_chunk",
  "content": { "type": "text", "text": "..." }
}
~~~

同时，一些 thinking、thought、reasoning 类型的 text_delta 也会被视为思考内容。

这比从数据库的 title 或终端画面推测思考更直接。

### 5.5 工具状态

当 step 类型是 tool，或者包含 tool_info / tool_name 时，处理器会生成：

- 初始 tool_call；
- 后续 tool_call_update；
- in_progress；
- completed；
- failed。

工具 ID 使用：

~~~text
agy-<step_index>
~~~

工具参数、输出、错误和文件路径会尽量放入 ACP 的 rawInput、rawOutput、locations 和 content。

## 6. 工具映射策略

src/tools.rs 没有依赖数据库 schema，而是根据工具名称和字段进行通用映射。

例如：

~~~text
write / edit / patch          → edit
delete / remove               → delete
move / rename                 → move
read / view / list            → read
grep / search / find          → search
command / execute / terminal  → execute
think / plan / reasoning      → think
fetch / url                   → fetch
~~~

路径字段会从以下名称中寻找：

- AbsolutePath；
- DirectoryPath；
- SearchPath；
- FilePath；
- path；
- fileUri；
- Cwd。

这是一种轻量、灵活的映射方式，但它也有一个限制：工具类型和字段名称变化时，适配器可能只能退化为 other 或丢失位置信息。

## 7. 会话持久化机制

项目将 session 映射保存到：

~~~text
~/.openab/agy-acp/sessions.json
~~~

保存内容包括：

- conversation_id；
- last_step_idx；
- model_id。

写入过程使用：

1. 独立 .lock 文件获取排他锁；
2. 读入现有 JSON；
3. 修改目标 session；
4. 写入临时文件；
5. rename 替换正式文件。

因此它没有依赖 Google 的 conversation DB 来维护 ACP 自己的 session 绑定。

需要注意，session/load 主要恢复会话绑定，并不负责完整历史 replay。当前代码的职责更接近：

~~~text
恢复上下文 ID
而不是
重新发送全部历史更新
~~~

## 8. 取消和进程生命周期

session/cancel 会设置一个 AtomicBool。处理 prompt 的任务发现标志后，会调用子进程 kill，并等待进程结束。

这种设计比轮询数据库判断“是否取消”直接得多，但仍有两个限制：

- Windows 下 kill() 的语义和 Unix 的 SIGINT 不同；
- 如果 agy 产生了额外的工具子进程，单独终止父进程不一定能清理完整进程树。

## 9. 这条路线为什么最接近正确方向

### 9.1 使用真正的机器协议

数据源是：

~~~text
agy 官方 stdout 事件流
~~~

不是：

~~~text
终端画面
~~~

也不是：

~~~text
内部持久化数据库
~~~

这减少了中间推断。

### 9.2 低延迟

事件一到 stdout 就可以解析并通知 ACP，不需要等待 200 毫秒轮询，也不需要等待 SQLite 提交到可读快照。

### 9.3 传输路径简单

~~~text
agy stdout
  ↓
BufReader
  ↓
serde_json
  ↓
ACP notification
~~~

没有 node-pty、SQLite、WAL、protobuf schema 和文件扫描。

### 9.4 便于区分事实和推测

step_update、tool_info、thought_delta 和 result 都来自 agy 的显式事件。适配器不需要根据数据库行状态猜测 Agent 是否完成。

## 10. 代码中的限制和需要改进的地方

### 10.1 Rust 的环境门槛

使用者需要：

- Rust toolchain；
- Cargo；
- 对应平台的 release build。

对于普通 Zed 用户来说，直接分发预编译二进制会比要求用户本地编译更合理。

### 10.2 只有 Stdio，没有 HTTP/SSE

当前实现只提供：

~~~text
stdin/stdout JSON-RPC
~~~

它适合 Zed 等本地 ACP Host，但不能直接给 Web Studio 或 Electron renderer 提供 HTTP/SSE 服务。

### 10.3 权限交互能力有限

README 要求使用者通过 AGY_EXTRA_ARGS 开启 --dangerously-skip-permissions，原因是这个 Rust 适配器没有把 agy 的交互权限菜单完整桥接到 ACP。

这使得实现简单，但降低了安全控制能力。

### 10.4 stdout 存在并发写入风险

代码中，agy stdout 读取任务会直接写入 stdout；主 JSON-RPC 循环也会写入 stdout。

~~~text
主循环 → stdout
stdout reader task → stdout
~~~

如果多个任务同时写入，至少需要保证每条 JSON 行的顺序和完整性。更稳妥的实现应该让所有输出先进入一个单一 writer channel，再由一个 writer task 串行写出。

### 10.5 全局 Adapter 锁可能限制并发

main.rs 中的 Adapter 通过 Tokio Mutex 保护，而 prompt 处理会在持锁期间等待 agy 子进程完成。这意味着多个会话之间可能被全局串行化。

如果未来需要多会话并发，应该将状态拆分为：

~~~text
全局只读配置
      +
每个 session 独立状态和子进程
      +
单独的输出路由
~~~

### 10.6 stream-json 输入方式需要锁定 CLI 版本

当前代码使用 -p <prompt> 启动 stream-json。不同版本的 agy 对 streaming 模式的 stdin/argv 约定可能不同，官方文档当前对流式输入也有专门说明。

因此实现必须：

- 固定支持的 agy 版本；
- 在 CI 中测试真实 CLI；
- 验证 prompt 是否真的进入流式会话；
- 对 init、step_update、result 做 schema 兼容处理。

### 10.7 仅认识有限事件类型

未知事件会被忽略。这样可以容忍部分版本变化，但也可能造成“Agent 运行了，却没有任何 ACP 更新”的静默失败。

更好的做法是记录：

- 未知事件名称；
- 原始 JSON 的摘要；
- 当前 agy 版本；
- sessionId 和 conversationId。

## 11. 与前两条路线的区别

| 维度 | 路线 A：shindgew | 路线 B：shubzkothekar | 路线 C：hicder |
|---|---|---|---|
| Agent 数据源 | SQLite；PTY 辅助权限 | SQLite | stream-json stdout |
| PTY | 使用 | 不使用 | 不使用 |
| 数据库依赖 | 强 | 强 | 无 |
| 事件获取 | 约 200ms 轮询 | 约 200ms 轮询 | 逐行实时读取 |
| 权限交互 | 支持较完整 | 默认跳过权限 | 主要依赖跳过权限 |
| 历史回放 | 较丰富 | 较丰富 | 主要恢复绑定，不完整回放 |
| 语言 | TypeScript/Node | TypeScript/Bun | Rust |
| HTTP/SSE | 当前主要是 Stdio | 当前是 Stdio | 仅 Stdio |
| 维护风险 | PTY + DB + schema | DB + schema | CLI stream schema |

## 12. 总结评价

hicder/agy-acp 的核心方向最干净：

~~~text
ACP JSON-RPC
    ↕
内存中的进程管道
    ↕
agy stream-json
~~~

它的主要问题不是传输架构，而是产品化不完整：

- Rust 使用门槛较高；
- 没有 HTTP/SSE；
- 权限能力有限；
- 并发输出需要加强；
- 需要严格适配 agy 版本；
- 当前 session load 和历史恢复能力有限。

因此，最值得继承的是它的传输思想，而不一定是完整代码结构：

> 使用原生 agy --output-format stream-json 作为唯一实时事件源，再在上层增加稳定的会话管理、权限桥接、HTTP/SSE 和统一输出路由。

