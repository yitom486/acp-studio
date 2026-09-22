# acp-studio

> **Google Antigravity ACP Studio & Universal IDE Gateway**  
> 一站式 Google Antigravity 官方 CLI (`agy`) 图形化工作台与通用 ACP (Agent Client Protocol) 协议网关，支持 **Zed**、Cursor 等现代编辑器无缝接入。

[![Protocol](https://img.shields.io/badge/Protocol-ACP%20v1%20%2F%20v2-blue.svg)](https://agentclientprotocol.com)
[![Engine](https://img.shields.io/badge/Engine-Google%20Antigravity%20(agy)-green.svg)](https://antigravity.google)
[![Core Library](https://img.shields.io/badge/@yitom/agy--acp--map-v0.1.13-purple.svg)](https://www.npmjs.com/package/@yitom/agy-acp-map)
[![Tests](https://img.shields.io/badge/Tests-74%20Vitest%20(universal)-success.svg)]()
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-orange.svg)]()

> 注：`74 Vitest (universal)` 为 `tests/universal` + `tests/proxy` 本地计数；黑盒/端到端需本地 `bun` 环境运行（见“快速开始 §5”）。

---

## 📖 项目背景与目的 (Project Purpose)

Google Antigravity CLI (`agy`) 是 Google DeepMind 打造的新一代终端智能编程辅助智能体，原生搭载 Gemini 3.8 / 3.7 系列深度推理大模型。官方 CLI 主要以命令行 TUI 交互运行。

在实际日常开发中，开发者面临两大核心诉求：
1. **图形化可视化交互**：需要一个兼具现代极客美感（Glassmorphism 暗黑流光质感）、支持 Markdown 渲染、思考流（Thinking Chunks）折叠展示、工具调用（Tool Calls）实时状态机感知、多轮连续流式会话的 Web Studio。
2. **现代编辑器（IDE）无缝原生集成**：希望直接在 **Zed**、Cursor 等全面拥抱 **ACP (Agent Client Protocol)** 标准的现代代码编辑器中，把 Antigravity 作为常驻 AI 编程结对伙伴使用。

**`acp-studio`** 正是为此而生的一体化全栈工程，既提供了即开即用的现代化 Web 对话 Studio，也提供了可以直接给 Zed 等编辑器配置的标准 Stdio ACP Server。

---

## 🌟 核心特性 (Key Features)

### 1. 双模协同架构 (Dual Mode Architecture)
- **Web Studio 模式 (`bun run dev`)**：
  - 前端运行于 `http://localhost:5188`，后端网关运行于 `http://localhost:3004`。
  - 基于 React 18 + Vite + TailwindCSS 打造的玻璃拟态现代界面。
  - SSE (Server-Sent Events) 高速流式传输，支持文字流、思考链、工具调用多轨分发。
- **ACP Stdio 模式 (`bun run acp:stdio`)**：
  - 符合官方标准规格的 Agent Client Protocol (v1/v2) Stdio Server。
  - 纯净 JSON-RPC 2.0 通道，诊断日志严格隔离于 `stderr`，可直接作为 Zed 等 IDE 的底层 Agent 后端。

### 2. 原生认证零配置 (Zero-Config Auth)
- 自动嗅探与复用本地系统已认证的 Google Antigravity 环境（`~/.gemini/bin/agy.exe` 或环境变量 `AGY_BIN`）。
- **零额外 API Key 配置**，无需翻找云端控制台或手动导入 Token，启动即连通 Google 官方底层环境。

### 3. 多轮会话长效稳定 (Robust Multi-Turn Sessions)
- 底层采用基于 `@yitom/agy-acp-map@^0.1.13`（以根 `package.json` 为准）的动态回调解耦机制（`setCallbacks`）。
- 彻底解决传统进程在第二轮提问时因闭包泄漏导致的事件挂起问题，支持无上限连续问答。
- 支持同一会话内动态热切换大模型（如 `gemini-3.8-flash-high` $\leftrightarrow$ `gemini-3.8-pro`），自动保持 `--conversation` 历史上下文。

### 4. 思考流与工具调用全感知 (Reasoning & Tool Visualization)
- **思考流独立抽取**：对具备深度推理能力的大模型，独立提取 `agent_thought_chunk` 并提供前端可折叠面板，正文回复与推理过程互不混淆。
- **工具调用状态机**：实时展现 `tool_call_update` 的执行中（`in_progress`）与完成（`completed`）状态，清晰审计文件读写、命令运行过程。

### 5. Windows 11 静默运行与零闪框防御
- 全链路调用统一注入 `{ windowsHide: true }`，有效压制控制台黑框。
- 控制台二进制（`bunx.exe`/`npx.cmd` 等）走运行时白名单直起（`spawn` + `windowsHide`，见 `AgentConnection.spawnCrossPlatform`），Bun/Node 下均无闪框；只有显式设置 `AGY_HEADLESS_LAUNCHER` 才走 GUI shim，只认环境变量，绝不静默降级。
- 结合进程池常驻写入管道，杜绝每轮问答唤起 `cmd.exe` / `conhost.exe` 的视觉干扰。

### 6. 自动化测试 (Test Grid)
- 内置零云端调用的离线 Mock CLI 仿真器（[`tests/fixtures/mock-agy-cli.cjs`](./scratch/repos/yitom486-agy-acp-map/tests/fixtures/mock-agy-cli.cjs)）。
- 主工程 **Vitest** 套件：`tests/universal`（13 文件）+ `tests/proxy`，共约 **74 项**（本地 `bun run test` 秒级完成，零联网开销）；底层桥接库另有自带黑盒测试，需本地 `bun` 运行。

---

## ⚡ 在 Zed 编辑器中配置与使用指南 (Zed Integration)

**是的，本项目构建或运行后，可以直接在 Zed 编辑器中配置使用！**

Zed 编辑器原生支持 Agent Client Protocol (ACP)。您可以按照以下步骤将 Antigravity 接入 Zed 的 Assistant 面板：

### 方式一：经由本项目 Universal 网关接入（推荐，支持实时本地调试）

1. 先本地启动网关：`bun run dev`（Bun 入口 `server/index.ts`，Node/Electron 入口 `server/node.ts`，网关实现在 `server/universal/`）；
2. 打开 Zed 编辑器，按快捷键 <kbd>Ctrl</kbd>+<kbd>,</kbd> 打开用户配置文件 `settings.json`（或在菜单栏选择 `Zed` -> `Preferences` -> `Open Settings`）；
3. 在 `settings.json` 中添加或合并 `agent_client_protocol` 配置项（codex 同款 runner 直起，和 Studio 预设完全一致）：

```json
{
  "assistant": {
    "version": "2"
  },
  "agent_client_protocol": {
    "servers": {
      "antigravity": {
        "command": "bunx",
        "args": ["@yitom/agy-acp-map@latest"]
      }
    }
  }
}
```
*(没装 bun 就把 `command` 换成 `npx`、`args` 换成 `["-y", "@yitom/agy-acp-map@latest"]`。`bun run acp:stdio` 跑的也是这一条。)*

### 方式二：全局安装后直连（离线/锁版场景）

先 `npm install -g @yitom/agy-acp-map`，再配置为（和 Studio/方式一跑的是同一个 `bin.js`，只是来源换成本地全局包）：

```json
{
  "agent_client_protocol": {
    "servers": {
      "antigravity": {
        "command": "node",
        "args": ["<npm-root-g>/@yitom/agy-acp-map/dist/bin.js"]
      }
    }
  }
}
```

其中 `<npm-root-g>` 为 `npm root -g` 的输出。日常推荐方式一（`bunx @latest`，永远最新，免维护）。

### 在 Zed 中使用：
1. 配置保存后，在 Zed 右下角或按快捷键唤起 **Assistant** 面板；
2. 在模型/Agent 选择器下拉菜单中，选择 **`antigravity`**（或由 ACP 协议自动广播的 `Antigravity Agent`）；
3. 直接输入需求，即可在 Zed 中享受由 Google Antigravity 原生引擎提供的代码补全、工程重构与多轮问答服务！

---

## 🚀 快速开始 (Quick Start)

### 1. 环境要求
- [Bun](https://bun.sh/) (推荐 v1.2+) 或 Node.js (v18+)
- 本地已安装并完成登录认证的 [Google Antigravity CLI](https://antigravity.google) (`~/.gemini/bin/agy.exe`)

### 2. 安装依赖
```bash
# 进入项目根目录
cd antigravity-acp

# 安装工程全量依赖（自动关联 workspaces）
bun install
```

### 3. 启动开发服务器（前后端联动）
```bash
bun run dev
```
启动成功后：
- **Web Studio 前端**：打开浏览器访问 [http://localhost:5188](http://localhost:5188)
- **后端通信网关**：监听于 `http://localhost:3004`（已启用 `--watch` 毫秒级热重载）

### 4. 独立运行 ACP Stdio 服务（用于接入 Zed/Cursor 等外部工具）
```bash
bun run acp:stdio
```

### 5. 执行全量自动化测试 (Vitest)
```bash
bun run test
```
将自动运行 `tests/universal` + `tests/proxy`（覆盖客户端断线容错、思考流解析、代理健壮性、全流程多轮问答 E2E 模拟等），零联网开销，秒级完成（黑盒/端到端需本地 `bun`）。

### 6. 生产打包构建
```bash
bun run build
```

---

## 🛠️ 全链路可观测性日志分层 (Observability)

为了便于排查与分析，系统在整个运行链路上建立了清晰的结构化日志标识：

| 日志前缀 | 所在模块 | 说明 |
| :--- | :--- | :--- |
| **`[SSE-Client]`** | `src/lib/universal-api.ts` (`consumeUniversalChat`) | 浏览器 DevTools 控制台 (F12) 打印接收到的每包 SSE 帧 |
| **`[Server][SSE]`**| `server/index.ts` / `server/node.ts` + `server/universal/routes.ts` | 后端 HTTP/SSE 网关层，跟踪客户端连接、推流分块与优雅关闭 |
| **`[ACP-BRIDGE]`** | `server/universal/` (`registry.ts` / `AgentConnection.ts` / `agent-installer.ts`) | 桥接中枢层，记录会话创建、活跃计数、模型热切换与事件转发 |
| **`[ACP-SDK]`**    | `@yitom/agy-acp-map` SDK | 适配层，记录请求状态、`isWritable` 决策、多轮回调重定向与结算 |
| **`[ACP-PROC]`**   | `@yitom/agy-acp-map` Process | 子进程层，记录 `agy.exe` 的 PID、generation、stdin 载荷与 stdout 原生帧 |

---

## 📂 目录结构 (Directory Layout)

```text
antigravity-acp/ (acp-studio)
├── server/                        # 后端服务与协议网关
│   ├── index.ts                   # Bun HTTP / SSE Web 服务端 (端口 3004)
│   ├── node.ts                    # Node HTTP 入口 (Electron 内嵌网关用)
│   ├── gateway.ts                 # Hono 应用组装 (旧 Antigravity 路由 + universal 挂载)
│   └── universal/                 # Universal ACP 网关 (多 agent stdio 管理)
│       ├── routes.ts              # /api/universal/* HTTP/SSE 接口
│       ├── registry.ts            # agent profiles + 活连接注册表
│       ├── presets.ts             # 内置 presets (codex/antigravity-stdio/...)
│       ├── AgentConnection.ts     # 单 agent 长连接 (stdio 进程托管)
│       ├── agent-installer.ts     # headless launcher 定位/dev 本地源开关/空会话清理
│       └── errors.ts              # GatewayError + 错误码
├── src/                           # Antigravity Studio 前端 (React + Vite)
│   ├── App.tsx                    # Studio 主页面与多轮对话状态机
│   ├── components/                # 聊天气泡、思考链折叠、输入框、顶栏
│   └── lib/
│       └── universal-api.ts       # 前端 API + 坚固型 SSE 流消费 (防断连/防假死)
├── desktop/                       # Electron 桌面壳 (main/preload/build)
├── tests/universal/               # 主工程系统级集成测试 (Vitest, 13 文件约 72 项)
├── tests/proxy/                   # Vite 代理容错测试
├── scratch/repos/
│   └── yitom486-agy-acp-map/      # Universal ACP Bridge 核心库源码 (@yitom/agy-acp-map)
├── package.json                   # 工程配置文件 (桥接库版本以此处为准)
├── vite.config.ts                 # Vite 构建与代理配置 (端口 5188)
└── vitest.config.ts               # Vitest 自动化测试配置
```

---

## 🌐 Universal ACP 网关 (v1, 新增)

`acp-studio` 已从“Antigravity 专用”升级为**通用 ACP 客户端**：后端新增 `server/universal/` 独立网关，基于 `@agentclientprotocol/sdk@1.4` 的 `client().connect(ndJsonStream)` 直连任意 ACP stdio agent，前端已重写为多 Agent 工作台。

- 内置 presets：`codex` (`npx -y @agentclientprotocol/codex-acp`)、`antigravity-stdio`、`gemini`、`claude`、`opencode`、`copilot`、`cursor`；可通过 `ACP_AGENTS_JSON` 环境变量或 `POST /api/universal/agents` 追加自定义 `{id,command,args,env}`。
- 完整 v1 客户端能力：`fs/read+write` 真实文件透传、`terminal/*` 真实进程托管、`session/request_permission` 转前端审批、`elicitation/create` 转前端表单（JSON Schema 渲染 + 原始 JSON 回退）、`initialize/authenticate/logout`、`session/new/load(历史回放)/resume/list/close/delete`、`session/set_mode`、`session/set_config_option`（select/boolean 形态）、`session/prompt+cancel`，另有 `session/fork` 与 `providers/list|set|disable` 透传（能力协商，有则启用）。
- 全量 `session/update` 渲染：`agent/user/thought` chunks、`tool_call(+update)`、`plan(+unstable plan_update)`、`available_commands`（输入框 `/` 联想）、`current_mode`、`config_option`、`session_info`、`usage`（token/费用），`fs/terminal/compaction` 进动态信息流，未知类型永不静默丢弃。
- Studio 工作台：左侧 Agents + Sessions 侧边栏（标题/时间、打开/fork/删除）、新会话设置（cwd、additionalDirectories、MCP servers JSON）、Providers 模型通道面板、附件发送（文本→embedded resource、图片→image block、其他→resource_link）、本地登录复用探测（codex 自动读取 `~/.codex/auth.json`，显示「本地已登录」）。
- 旧 Antigravity 路由 (`/api/status`、`/api/chat` 等) 完整保留，向后兼容。

```bash
bun run dev
# 前端 http://localhost:5188 -> 选择 Codex -> 连接 -> 认证 -> 新会话 -> 发送
# codex 需要 OPENAI_API_KEY / CODEX_API_KEY 或先完成 ChatGPT 登录
```

网关自测：`GET /api/universal/agents`、`POST /api/universal/agents/codex/connect`、`POST /api/universal/chat` (SSE)。

---

## 📌 桥接库三源版本对齐 (Version Drift)

`@yitom/agy-acp-map` 有三个来源，容易漂移，请按下表理解与对齐：

| # | 来源 | 位置/写法 | 语义 |
| :--- | :--- | :--- | :--- |
| 1 | 根 `package.json` | `"@yitom/agy-acp-map": "^x.y.z"`（当前 `^0.1.13`，以文件为准） | 本地开发/打包时的版本基线 |
| 2 | `scratch` 子仓库 | `scratch/repos/yitom486-agy-acp-map`（git submodule commit pin） | 桥源码联调位：想调桥源码时手动跑它，升级靠切 commit；日常运行不经过它 |
| 3 | runner 缓存 | `bunx @yitom/agy-acp-map@latest`（presets `pinLatest`，bun 优先、npx 兜底） | 用户机器上实际跑的 agent：Studio 直连 `@latest`，无 managed 常驻目录、不锁旧版 |

对齐策略：发版前 `bun update @yitom/agy-acp-map`（或检查 `latest`）→ 同步根 `package.json` 版本徽章与正文 → 需要联调再切 `scratch` commit；实际运行版本以 `initialize` 返回的 `agentInfo.version` 为准（连接成功即打印）。

---

## 🔌 Antigravity 集成方式（外部集成看这里）

三件事备齐即可接入，Studio、Zed、裸 `bunx` 走的是同一条桥：

1. **前置要求**：本机装好 [Google Antigravity CLI](https://antigravity.google) 并完成登录（桥复用它的登录态，零 API Key）；再有 **bun 或 Node.js 二选一**（`bunx` 优先、`npx` 兜底，Electron 不自带 npx）。
2. **Studio 内**：`antigravity-stdio` 预设即 `bunx @yitom/agy-acp-map@latest`（见 `server/universal/presets.ts`），首次连接下载约 5MB 进 runner 缓存，之后秒连；实际版本以连接成功打印的 `agentInfo.version` 为准。
3. **Zed 内**：见上文“Zed 集成”方式一（runner 直起）/方式二（npm 全局锁版）。

**记忆（两层，互不干扰）**：agy 原生 `agy -c/--conversation ID`（状态在 `~/.gemini/`）；桥的 `~/.agy-acp-map/history/*.jsonl` + `sessions.json`（bridge-sessionId → agy-conversationId 映射，换启动方式/升级不断档）。`session/load` 回放日记续聊，接不回去就明示报错并解绑，绝不静默串会话。

**失败策略**：缺 runner、缺登录、握手被拒一律 fail-fast，大声报错 + 修复指引，不做静默降级（见 `.agents/rules/no-silent-fallbacks.md`）。

---

## 📄 开源许可 (License)

本项目采用 [Apache-2.0 License](./LICENSE) 开源协议。
内部核心桥接库 `@yitom/agy-acp-map` 遵循对应独立开源授权规范。
