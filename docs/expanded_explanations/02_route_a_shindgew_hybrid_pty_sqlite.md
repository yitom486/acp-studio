# 社区路线 A：shindgew/agy-acp 的 PTY + SQLite 混合架构

本文根据当前 scratch/repos/shindgew-acp 中的代码，说明这个项目如何把 agy 接入 ACP，以及它的优点、复杂性和局限。

## 1. 先纠正一个容易产生的误解

此前的简化描述是：

~~~text
ACP Client
   ↓
node-pty
   ↓
agy 交互式终端
   ↓
解析 ANSI 终端画面
~~~

但当前仓库的实际实现并不是“纯 PTY 抓屏”。它更准确的结构是：

~~~text
                         ┌─ PTY：启动交互式 agy、输入 prompt、发送权限按键
ACP Client → agy-acp ────┤
                         └─ SQLite：读取 Agent 文本、工具状态、思考和生命周期
~~~

README.md 明确说明，PTY 输出只是诊断尾部和权限检测用途，Agent 文本不会从终端画面中解析出来。真正的 Agent 更新来自 ~/.gemini/antigravity-cli/conversations/<id>.db。

因此，这个项目是：

> PTY 负责控制交互式 CLI，SQLite 负责获取结构化事件，TypeScript 负责把两者重新组合成 ACP。

这比“完全靠正则解析终端画面”更可靠一些，但也意味着它同时继承了 PTY 和 SQLite 两套复杂性。

## 2. 项目组成

关键代码路径如下：

| 文件 | 作用 |
|---|---|
| src/main.ts | CLI 入口，处理登录模式并启动 ACP |
| src/acp/agent.ts | ACP 会话、初始化、prompt 和恢复逻辑 |
| src/agy/cli.ts | 启动 agy、选择 PTY/普通子进程、处理取消和权限 |
| src/agy/db/database.ts | 以 better-sqlite3 读取对话数据库 |
| src/agy/db/streaming.ts | 持续轮询数据库并识别工具、任务和结束状态 |
| src/agy/db/translator.ts | 把数据库 step 转换为 ACP 更新 |
| src/agy/db/step-payload.ts | 解码数据库中的二进制 step payload |
| src/agy/db/columns.ts | 解码权限、任务、子 Agent 等二进制列 |
| src/agy/edit/* | 处理文件编辑、回滚、客户端文件系统桥接 |
| src/acp/tool-calls/* | 权限选择和交互问题转换 |

依赖方面，它同时使用：

- @agentclientprotocol/sdk；
- node-pty；
- better-sqlite3；
- @bufbuild/protobuf；
- TypeScript 和 Node.js 22 运行时。

这说明它不是简单的“启动一个进程并转发文本”，而是一个相当完整的兼容层。

## 3. ACP 请求进入后的完整路径

### 3.1 会话初始化

Zed 等 ACP Host 启动 agy-acp 后，入口通过 Stdio 建立 JSON-RPC 连接。Agent 层负责：

1. 响应 initialize；
2. 创建或恢复 ACP sessionId；
3. 保存工作区路径和额外目录；
4. 查询可用模型；
5. 选择执行模式、模型和 reasoning effort；
6. 创建 AgyCliSession。

一个 ACP 会话通常对应一个长期存在的 AgyCliSession。在交互权限模式中，这个会话还会保留一个长期运行的 PTY。

### 3.2 第一次 prompt：确定 conversation 数据库

如果当前会话还没有 conversationId，代码会先扫描 conversations 目录，记录启动前已经存在的 .db 文件：

~~~text
启动前扫描已有 conversation.db
        ↓
启动 agy
        ↓
再次扫描目录
        ↓
找到新出现的 conversation_id.db
~~~

这个机制用于把 ACP 的 sessionId 绑定到 agy 创建的真实会话数据库。

它解决了一个现实问题：调用 agy 时，适配器一开始并不知道新会话的数据库 ID。

但它也引入了竞态：如果同一时间出现多个新数据库，代码无法安全判断哪个属于当前 prompt，通常会拒绝绑定。

## 4. 交互权限模式：PTY 与 SQLite 同时工作

默认情况下，如果没有传入 --dangerously-skip-permissions 或 --no-interactive-permissions，代码会启用 interactivePermissions。

### 4.1 启动交互式 agy

AgyCliSession.runInteractivePrompt() 会：

1. 创建 StreamPoller；
2. 通过 node-pty 启动 agy --prompt-interactive ...；
3. 使用固定的终端大小 cols: 120, rows: 40；
4. 监听 PTY 输出；
5. 每隔约 200 毫秒轮询 SQLite；
6. 把数据库中的更新转换成 ACP 通知；
7. 如果 Agent 被权限询问阻塞，就通过 PTY 写入方向键、回车等按键。

逻辑可以表示为：

~~~text
agy interactive PTY
      ├── stdout/终端输出 → 权限菜单检测、诊断尾部
      ├── stdin/PTY 写入  → prompt、方向键、确认键
      └── SQLite DB        → Agent 文本、工具状态、完成状态
~~~

### 4.2 PTY 输出并不负责解析 Agent 回复

当前代码中的 onData() 主要把 PTY 输出保存到两个缓冲区：

- #ptyOutput：用于报错和诊断；
- #ptyPermissionRender：用于延迟处理权限菜单。

flushPermissionRender() 会：

1. 处理可能被拆开的 ANSI 转义序列；
2. 删除部分 ANSI 控制码；
3. 检查是否出现 Allow this command?、Allow this tool 等文本；
4. 识别 Allow once、Always allow 等权限选项；
5. 增加权限菜单出现次数。

因此它没有试图从终端画面重建完整 Agent 对话，但仍然依赖终端文案和 ANSI 输出格式来判断“权限面板出现了”。

### 4.3 权限决定如何回写 PTY

ACP Host 的权限回调会返回适配器理解的选择，例如允许一次、始终允许或拒绝。

适配器再把它转换成：

~~~text
向下方向键 × N
回车
~~~

或者针对 ask_question 写入对应选择键。

这使得 ACP 客户端能够控制一个原本只支持终端交互的 agy。

### 4.4 取消和退出

取消交互式任务时，代码会：

1. 设置内部 #cancelled 标志；
2. 调用 PTY 的 kill()；
3. 最多等待约两秒；
4. 如果仍未退出，再尝试 SIGKILL。

这是必要的保护，但也说明 ACP 会话结束、PTY 退出、SQLite 最后一批记录写入之间存在多个异步生命周期。

## 5. 非交互模式：PTY 被绕过，但 SQLite 仍然存在

如果配置了跳过权限，代码会走 runPromptCommand()：

~~~text
agy --print ... -p <prompt>
        ↓
普通 Node 子进程
        ↓
stdout 被排空，但不作为 Agent 数据源
        ↓
SQLite StreamPoller 读取 conversation DB
~~~

这里有一个关键点：即使没有 PTY，项目仍然不直接消费 agy 的结构化 stdout，而是继续依赖数据库。

stdout 被排空是为了防止子进程写满管道后阻塞，但 Agent 内容仍由 SQLite 提供。

## 6. SQLite 流式读取机制

### 6.1 只读打开数据库

ConversationDb 使用 better-sqlite3 以只读方式打开数据库，并准备类似下面的查询：

~~~sql
SELECT idx, step_type, status, step_payload,
       error_details, permissions, task_details
FROM steps
WHERE idx > ?
ORDER BY idx;
~~~

代码还会检查：

- steps 表是否存在；
- subagent_details 或旧版列名是否存在；
- gen_metadata 表是否存在；
- WAL 文件和 -shm 文件的状态；
- SQLite data_version 是否发生变化。

### 6.2 解码二进制 payload

数据库中的很多字段不是普通 JSON，而是二进制编码的数据。适配器需要：

~~~text
SQLite BLOB
    ↓
protobuf / wire decoder
    ↓
StepRow
    ↓
ACP SessionUpdate
~~~

这也是项目代码量较大的原因之一。它不仅要读表，还要猜测和还原 agy 内部的 step schema。

### 6.3 处理正在写入的记录

代码考虑到 Agent 可能正在写入一个尚未完成的 row：

- 如果某个 payload 解码失败，则暂时丢弃这条记录；
- 不推进消费位置；
- 下一次轮询再尝试读取；
- 通过 data_version 和 row snapshot 判断是否有新变化；
- 在进程退出后再进行几次 trailing poll，补齐最后写入的记录。

这些措施确实提高了健壮性，但它们本身也说明：数据库并不是一个为外部实时订阅设计的事件接口，适配器必须自行补偿写入时序问题。

## 7. 数据库记录如何转成 ACP

Translator 负责把内部 step 转成 ACP 更新，包含：

- agent_message_chunk：Agent 文本增量；
- agent_thought_chunk：思考内容；
- tool_call / tool_call_update：工具生命周期；
- plan：计划内容；
- usage_update：token 使用量；
- 文件位置和 diff；
- 任务状态、权限和错误信息；
- 图片或其他内容块。

为了避免重复发送，代码会缓存：

- 每个文本 step 已经发送的字符长度；
- 每个工具调用上次发送的 snapshot；
- 每个计划的当前状态；
- 已经处理的任务和权限请求。

## 8. 这个项目做得好的地方

### 8.1 处理了 ACP 真实使用中的权限问题

纯 agy -p 模式无法让 ACP Host 直接回答终端权限菜单。这个项目通过 PTY 把终端权限交互桥接到 ACP，是一个有实际价值的解决方案。

### 8.2 数据库解析比抓屏更结构化

虽然读取私有数据库存在风险，但相较于解析终端布局，数据库中的 step、status、payload、权限字段更适合生成结构化工具状态。

### 8.3 支持丰富的编辑器体验

项目不仅返回纯文本，还尝试支持：

- 文件位置；
- 工具状态；
- diff；
- Zed 的文件系统桥接；
- 交互式权限；
- background task；
- 计划和 token usage；
- ACP v1 和 draft v2。

### 8.4 对状态变化考虑得比较细

包括数据库 WAL 状态、部分写入、后台任务、重复 tool update、客户端取消和工作区 reconciliation。这些都是实际运行时容易出问题的地方。

## 9. 为什么它仍然不是理想基础架构

### 9.1 同一个业务状态由两条通道共同决定

PTY 告诉适配器：

~~~text
终端可能出现了权限菜单
~~~

SQLite 告诉适配器：

~~~text
某个 tool step 当前处于 pending/completed/failed
~~~

适配器必须把这两种状态拼起来。如果 PTY 输出已经更新但 SQLite 尚未提交，或者 SQLite 已经记录了 pending 但终端菜单尚未完成绘制，就会出现时序差异。

### 9.2 node-pty 带来原生模块成本

node-pty 不是纯 TypeScript 库，包含原生扩展和终端实现。项目还需要处理：

- Windows 原生编译或预构建包；
- Node 版本兼容；
- CPU 架构；
- spawn-helper 权限；
- 终端尺寸和平台行为；
- 原生模块安装失败。

这正是采用纯 stdio 的适配器可以避免的复杂度。

### 9.3 仍然强依赖未公开数据库结构

项目需要知道：

- 数据库目录；
- steps 表；
- step type 数字含义；
- status 数字含义；
- protobuf/wire 编码；
- permissions、task_details、gen_metadata 的字段结构。

只要 Google 修改内部 schema，项目就可能出现：

- Agent 文本不再显示；
- 工具状态不更新；
- payload 解码失败；
- 会话无法结束；
- 历史回放错误。

### 9.4 200 毫秒轮询不是实时事件订阅

轮询间隔决定了两个取舍：

- 间隔短：延迟小，但每个会话持续产生 SQLite 查询和对象解码；
- 间隔长：CPU 和磁盘 I/O 较低，但 UI 更新不够及时。

多个 ACP 会话同时运行时，这个成本会按会话数增长。

### 9.5 新 conversation 的发现存在竞态

代码通过“启动前后目录差集”寻找新数据库。如果同一时间出现两个新会话，适配器不能安全判断归属，只能放弃绑定。

这是文件扫描无法彻底解决的问题。真正可靠的做法应该是从 agy 的结构化初始化事件中直接获取 conversation_id。

### 9.6 权限解析仍然依赖终端文案

虽然项目没有用 PTY 解析完整 Agent 文本，但权限识别仍然匹配类似：

~~~text
Allow this command?
Allow this tool
Yes, and always allow
~~~

如果 agy 更换语言、文案、ANSI 绘制方式或菜单交互，这部分仍可能失效。

## 10. 总结评价

shindgew/agy-acp 的实际特点是：

~~~text
强项：权限桥接、丰富 ACP 状态、文件编辑体验
代价：node-pty + SQLite + protobuf + 终端文案检测
~~~

它比纯 ANSI 抓屏方案更成熟，因为 Agent 正文和工具状态主要来自数据库；但它仍然不是理想的长期架构，因为它同时依赖：

~~~text
交互式 PTY
+ 私有 SQLite schema
+ protobuf/wire 解码
+ 200ms 轮询
+ 终端权限文案
~~~

适合把它当作一个功能丰富的兼容性实现或研究样本，不适合作为最小、稳定、低维护成本的核心传输层。

