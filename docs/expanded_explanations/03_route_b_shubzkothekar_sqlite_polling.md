# 社区路线 B：shubzkothekar/antigravity-acp 的 SQLite 轮询架构

本文根据当前 scratch/repos/shubzkothekar-acp 的代码，说明这个项目如何通过 Bun 启动 agy，再通过读取 SQLite 对话数据库构造 ACP 流。

## 1. 一句话概括

这个项目的核心策略是：

> 不读取 agy 的 stdout，而是把 agy 当作写入 SQLite 的黑盒进程，适配器定时读取数据库中的新增 step。

整体路径是：

~~~text
Zed / ACP Host
      ↓ Stdio JSON-RPC
Bun ACP Server
      ↓ Bun.spawn
agy -p <prompt>
      ├── stdout：忽略
      ├── stderr：读取错误
      └── SQLite：写入 conversation/<id>.db
                         ↓
                 Bun SQLite 轮询
                         ↓
                 protobuf 解码
                         ↓
                 ACP session/update
~~~

它没有使用 node-pty，也没有消费 stream-json。

## 2. 代码结构

| 文件 | 作用 |
|---|---|
| index.ts | 启动 Bun、重定向日志、自动安装 agy、建立 ACP 连接 |
| src/acp/server.ts | Bun Stdio 与 ACP ndJsonStream 的连接层 |
| src/acp/agent.ts | ACP 初始化、会话、prompt、load/resume、模型配置 |
| src/acp/adapter.ts | 启动 agy、轮询数据库、发送更新 |
| src/acp/sessions.ts | 内存会话注册、恢复和 LRU 淘汰 |
| src/agy/process.ts | 构造命令参数并调用 Bun.spawn |
| src/agy/binary.ts | 解析本地、下载目录、环境变量和 PATH 中的 agy |
| src/agy/installer.ts | 下载并校验 agy 二进制 |
| src/conversation/database.ts | 只读打开 SQLite，读取 steps 表 |
| src/conversation/streaming.ts | 实时轮询新 step |
| src/conversation/replay.ts | 历史会话回放和增量缓存 |
| src/conversation/translator.ts | 把 step 统一转换为 ACP 更新 |
| src/conversation/scan.ts | 发现新建的 conversation 数据库 |
| src/store/sessionStore.ts | 持久化 ACP session 与 conversation 绑定 |
| src/updates/tools/* | 各类工具调用的 ACP 映射 |

项目的一个特点是：它把“实时流”和“历史回放”设计成同一个 Translator 的两种模式。

## 3. 启动过程

### 3.1 日志和协议分离

index.ts 启动时把 console.log、console.info、console.warn 和 console.debug 重定向到 stderr。

原因是：

~~~text
stdout = ACP JSON-RPC 数据
stderr = 日志和诊断信息
~~~

这避免普通日志污染 ACP Stdio 通道，是正确的协议实现习惯。

### 3.2 自动安装 agy

binary.ts 按以下顺序查找 agy：

1. 编译后可执行文件旁边的 agy；
2. 包内 bin/agy；
3. AGY_BIN 环境变量；
4. 系统 PATH 中的 agy。

如果找不到，安装脚本会下载相应平台的 agy，并进行 SHA-256 校验。

这让用户可以直接安装 ACP Server，而不必提前手动安装 CLI，但也增加了网络、版本和供应链管理责任。

## 4. prompt 的实际执行过程

### 4.1 先寻找 conversation 数据库

如果会话还没有 conversationId，Adapter.runPrompt() 会在启动 agy 前调用 conversationSnapshot()，保存当前目录中的所有 .db 文件名。

之后启动 agy，再由 StreamPoller 找出新出现的数据库。

~~~text
before = {a.db, b.db}
spawn agy
after  = {a.db, b.db, c.db}
绑定 c.db
~~~

如果同时出现多个新数据库，代码会拒绝选择，因为无法确认哪个是当前 prompt 创建的。

### 4.2 构造命令参数

buildAgyArgs() 会加入：

- --add-dir <workingDir>；
- 额外工作区目录；
- AGY_EXTRA_ARGS；
- --conversation <id>；
- --model <id>；
- --dangerously-skip-permissions；
- -p <prompt>。

特别需要注意的是：当前代码在 ACP 模式下总是跳过权限，因为 ACP Host 没有通过终端菜单回答 agy 权限询问的通道。

### 4.3 启动子进程

spawnAgy() 使用：

~~~text
stdin  = ignore
stdout = ignore
stderr = pipe
~~~

也就是说，agy 的 stdout 不被用来传递 Agent 文本。适配器只读取 stderr 以便报告错误。

这也是这个项目和 stream-json 架构最本质的区别。

## 5. SQLite 实时轮询机制

### 5.1 保持一个只读数据库连接

ConversationDb.open() 使用 Bun 的 bun:sqlite 打开 <conversationId>.db，并确认 steps 表存在。

它准备的查询类似：

~~~sql
SELECT idx, step_type, status, step_payload,
       error_details, permissions, task_details
FROM steps
WHERE idx > ?
ORDER BY idx;
~~~

与每次轮询都重新打开数据库相比，项目选择在一次 prompt 期间复用同一个数据库句柄和 prepared statement。

### 5.2 按固定间隔轮询

常量 POLL_INTERVAL_MS 为 200 毫秒。实时循环大致是：

~~~text
while agy 尚未退出:
    读取 idx > lastStepIdx 的记录
    解码 protobuf payload
    转换为 ACP 更新
    发送给客户端
    等待 200ms
~~~

进程退出后还会额外执行几次 trailing poll，以补上 Agent 刚写入但尚未被上一轮读取的记录。

### 5.3 二进制 payload 解码

step_payload、error_details、permissions 和 task_details 等列不是简单的文本。项目通过生成的 protobuf 定义和 decoder 进行转换：

~~~text
SQLite BLOB
      ↓
StepPayload.decode()
      ↓
StepRow
      ↓
Translator
      ↓
ACP SessionUpdate
~~~

因此这个项目虽然没有解析终端画面，但仍然深度依赖 agy 私有的数据编码和内部表结构。

## 6. 实时 Translator 如何避免重复

数据库中的 Agent 文本可能会在同一个 step 中不断增长，而不是每次都新增一行。因此 Translator 维护了多种状态：

- agentTextLengths：某个文本 step 已经发送了多少字符；
- emittedSteps：已经发送过的工具 step；
- pendingAgentParts：历史回放时暂存连续 Agent 文本；
- lastStepIdx：当前消费到的最高 step 索引。

实时模式发送新增的文本尾部：

~~~text
数据库中的文本：Hello, I will inspect the file...
上次已发送：    Hello, I will
本次发送：                  inspect the file...
~~~

回放模式则会按消息边界合并文本，并重新构造完整历史。

## 7. 历史回放和持久化

### 7.1 历史回放

session/load 不只是恢复 conversationId，还会读取整个 SQLite 对话并重新生成 ACP 更新，包括：

- 用户 prompt；
- Agent 文本；
- 工具调用；
- 工具结果；
- 任务状态；
- 权限和错误信息；
- 标题和思考内容。

### 7.2 增量缓存

项目会按数据库的文件状态缓存回放结果，并使用 mtime、size 等信息判断数据库是否变化。

这能减少重复回放的成本，但也存在一个隐含前提：对话数据库大体上是追加写入的，且文件元数据能够准确反映可读内容的变化。

### 7.3 ACP session 持久化

SessionStore 将状态写入：

~~~text
~/.agy-acp/sessions.json
~~~

写入通过进程内 Promise 链串行化，并使用临时文件加 rename 的方式提交，避免两个异步写入相互覆盖。

## 8. 这个项目做得好的地方

### 8.1 不需要 node-pty

它没有启动交互式终端，避免了：

- C++ 原生编译工具链；
- ConPTY/PTY 差异；
- 终端宽度和 ANSI 光标控制；
- 权限菜单键盘模拟。

### 8.2 Bun 生态实现较轻量

项目使用：

- Bun.spawn；
- bun:sqlite；
- Bun Web Streams；
- @agentclientprotocol/sdk；
- Bun 编译为单文件可执行程序。

这使得运行时结构比较简单，安装和编译成本低于带 node-pty 的 Node 项目。

### 8.3 回放能力完整

从工程角度看，它不只关心“实时显示”，还处理了：

- session/load；
- session/resume；
- 历史回放；
- 增量缓存；
- 工具调用细节；
- 文件路径和行号；
- 任务和权限错误。

### 8.4 会话和进程关系比较清楚

Adapter 维护 sessionId → child process 的映射，取消时可以定位对应子进程，而不是依赖全局扫描。

## 9. 为什么这种路线仍然不够理想

### 9.1 SQLite 被当作实时 IPC 总线

这是最根本的问题：

~~~text
agy 内部 Agent
    ↓ 写入
SQLite WAL 数据库
    ↓ 外部轮询
ACP Adapter
~~~

数据库原本主要用于持久化历史，而不是作为实时事件订阅协议。适配器必须自行解决：

- 什么时候打开数据库；
- 哪个数据库属于当前 prompt；
- 哪些 row 已经稳定；
- 哪些文本仍在原地增长；
- 哪些状态是最终状态；
- 什么时候 Agent 真正完成。

### 9.2 WAL 并发读取存在时序和锁风险

SQLite 的正确只读连接通常可以和写入者并存，因此不能简单说“只要读 WAL 就必然死锁”。

但这个架构仍然有风险：

- writer 正在提交时，reader 可能看到旧快照；
- .db、-wal、-shm 文件的状态可能不同步；
- 文件刚出现时表可能还没有准备好；
- 某些平台或 native SQLite 构建可能返回 busy/locked；
- 进程异常退出时读句柄、WAL 和临时状态可能处于边界状态；
- 如果绕过 SQLite 正常事务语义读取文件元数据，判断可能失真。

项目通过复用连接、捕获 decode 错误、重试和 trailing poll 做了大量补偿，但这些补偿本身就是维护成本。

### 9.3 强依赖未公开 schema 和数字枚举

代码依赖：

- steps 表；
- step_type 的数字含义；
- status 的数字含义；
- protobuf message 定义；
- permissions、task_details 的字段结构；
- gen_metadata 的格式。

Google 只要修改内部数据库结构，项目就需要重新逆向、生成 decoder、修改 Translator 和测试夹具。

### 9.4 固定 200 毫秒轮询带来延迟和开销

单个会话的延迟通常至少受轮询间隔影响。多个会话同时运行时，查询、解码和对象转换会重复发生。

与真正的 stdout 事件流相比，轮询无法自然表达：

~~~text
事件刚刚产生
~~~

它只能不断询问：

~~~text
现在数据库里有没有新东西？
~~~

### 9.5 新 conversation 识别存在竞态

启动前后扫描 .db 文件是一个启发式方法。在下面场景中可能无法绑定：

- 两个 ACP 会话同时创建数据库；
- 用户同时运行原生 agy；
- 旧进程重试时创建了额外数据库；
- 数据库创建和第一次写入之间存在延迟。

### 9.6 永远跳过权限有安全含义

当前 buildAgyArgs() 为 ACP 模式添加 --dangerously-skip-permissions，因为它没有交互式权限通道。

这能避免 Agent 卡在终端确认，但也意味着：

~~~text
ACP 客户端不能逐次批准危险操作
~~~

如果上层没有额外的工作区隔离、命令白名单或沙箱，这会扩大 Agent 的实际权限。

### 9.7 没有使用官方结构化 stdout

这个项目将 stdout 忽略掉，因此即使 agy 提供 stream-json，它也无法直接获得：

- 官方事件顺序；
- 原始事件类型；
- 原始工具参数；
- 原始错误和完成事件。

所有信息都必须等待数据库写入，再由适配器反向推断。

## 10. 适合用在什么地方

这条路线适合：

- stream-json 不可用或不稳定的旧版本 agy；
- 需要完整历史回放；
- 研究 agy 内部 step 和工具状态；
- 临时构建 ACP 兼容层。

它不适合作为长期稳定的主传输层，除非：

- 官方明确承诺数据库 schema 稳定；
- 有可靠的跨平台 SQLite 测试；
- 有明确的 schema/version 兼容层；
- 接受轮询延迟和持续 I/O 成本。

## 11. 总结评价

shubzkothekar/antigravity-acp 比 PTY 抓屏方案更简单，代码也比较清晰：

~~~text
Bun ACP Server
    ↓
Bun.spawn agy
    ↓
SQLite 只读连接
    ↓ 200ms 轮询
protobuf 解码 + Translator
    ↓
ACP 更新
~~~

它最大的优点是绕开了 node-pty，最大的缺点是把 Google 的内部 SQLite 数据库当成了实时协议。

因此它不是“完全不能用”，而是更适合被视为：

> 一个功能完整的数据库逆向和 ACP 回放实现，而不是最稳定的实时事件适配架构。

