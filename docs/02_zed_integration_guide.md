# Zed 编辑器极速接入指南（零 C 盘占用版）

本文档指导如何在 **Zed 编辑器** 中无缝挂载本项目作为外部 Agent 服务，替换掉原先导致 C 盘膨胀的官方 PyInstaller 外部服务，实现零磁盘浪费、极速启动的原生 Antigravity 体验。

---

## 1. 接入原理概述

Zed 编辑器原生支持 **Agent Client Protocol (ACP)** 协议标准。当您在 Zed 的 Agent Panel（右侧智能体面板）中发起对话时，Zed 会启动一个子进程，并通过标准输入输出（`stdio`）与该子进程以 **JSON-RPC 2.0** 格式进行双向通信。

本项目的 `server/acp-stdio.ts` 扮演标准 ACP 服务端角色：
- **上行**：承接 Zed 发来的 `initialize`、`session/new`、`session/prompt`、`session/cancel` 请求；
- **下行**：实时驱动本地原生 `agy.exe`，将结构化事件转译为 `session/update` 通知推回给 Zed。

---

## 2. 配置步骤

### 步骤一：使用无黑框极速启动器（推荐，100% 杜绝控制台弹窗）
在 Windows 下，若直接调用 `cmd.exe` 或 `bun.exe`，Windows 内核会默认给控制台程序分配 `conhost.exe` 黑色控制台窗口。
本项目根目录已内置经过 GUI 子系统（`/target:winexe`）编译的 **`run-zed-acp-silent.exe`**，彻底杜绝任何黑框弹窗与闪烁，并自动双向高频透传 Stdio 管道。

---

### 步骤二：在 Zed 中配置外部 Agent
打开 Zed 编辑器，按 `Ctrl+,`（或打开 `%APPDATA%\Zed\settings.json`），在配置文件中加入 `agent_servers` 配置块：

#### 推荐方案：原生无黑框模式（100% 无弹窗、零闪烁）
```json
{
  "agent_servers": {
    "agy-acp-map-local": {
      "type": "custom",
      "command": "d:\\project\\js\\Electron\\antigravity-acp\\run-zed-acp-silent.exe",
      "args": [
        "d:\\project\\js\\Electron\\antigravity-acp\\scratch\\repos\\yitom486-agy-acp-map\\src\\sdk-server.ts"
      ],
      "env": {
        "HTTP_PROXY": "http://127.0.0.1:7897",
        "HTTPS_PROXY": "http://127.0.0.1:7897",
        "NO_PROXY": "localhost,127.0.0.1,::1"
      }
    }
  }
}
```

> **或者使用无需参数的自检测模式**（`run-zed-acp-silent.exe` 会自动寻找项目中的 `sdk-server.ts` 或 `acp-stdio.ts`）：
> ```json
> {
>   "agent_servers": {
>     "agy-acp-map-local": {
>       "type": "custom",
>       "command": "d:\\project\\js\\Electron\\antigravity-acp\\run-zed-acp-silent.exe",
>       "args": []
>     }
>   }
> }
> ```

---

## 3. 在 Zed 中使用体验

完成配置并保存 `settings.json` 后，在 Zed 中：

1. **打开 Agent Panel**：
   - 点击右侧栏的 Agent 图标，或者按快捷键 `Ctrl+?` 打开助手面板。
2. **选择智能体服务**：
   - 在面板顶部模型/提供者下拉列表中，选择我们刚刚注册的 **`Antigravity CLI`**。
3. **模型与模式切换**：
   - 适配器会自动暴露通过 `agy models` 探测到的官方模型清单（支持 `Gemini 3.8 Flash (High)`、`Claude Sonnet 4.6 (Thinking)`、`GPT-OSS 120B` 等）。
   - 在下拉菜单中直接切换模型，Zed 会通过 `session/setConfigOption` 或 `session/set_model` 同步下发给适配器。
4. **流式与思考流展示**：
   - 发送 Prompt 后，Zed 能够原生接收到适配器推送的逐字打字机效果。
   - 对于具备 Thinking 特性的模型，Zed 将展示实时折叠的深度思考过程。
5. **安全终止（Cancel）**：
   - 在生成过程中点击 Zed 的“停止生成”按钮，Zed 会发出 `session/cancel` 请求，适配器会瞬间终止正在运行的 `agy.exe` 子进程，避免无谓消耗算力。

---

## 4. 故障排查与日志

### 1. Zed 报错无法连接或闪退
- **原因**：Stdio 管道被非标准 JSON 的日志字符污染（例如使用了普通的 `console.log` 打到了 stdout）。
- **解法**：本适配器已进行管道隔离——标准输出（`stdout`）完全独占用于传输 JSON-RPC 报文；所有的调试日志与警告一律重定向至标准错误（`stderr`），Zed 会在调试日志中捕获 stderr，而不影响通信协议。

### 2. 查看 Zed Agent 运行日志
- 在 Zed 中按下 `Ctrl+Shift+P` 打开命令面板；
- 输入 `zed: open log` 打开 Zed 运行日志；
- 检索 `[Antigravity CLI]` 或 `[ACP Stdio]`，即可查看底层握手与交互详情。
