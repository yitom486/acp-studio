# ACP ↔ agy CLI 双向协议转译规范书

本文档详细定义 **Agent Client Protocol (ACP) JSON-RPC 2.0** 报文与底层 **Google Antigravity CLI (`agy.exe`) NDJSON 事件流** 之间的完整双向字段映射与状态机转换规则。

---

## 1. 协议总线与生命周期模型

```
[ACP Client (Zed / HUD)]                [ACP Adapter]                 [Native agy.exe]
         |                                    |                              |
         | --- 1. initialize --------------> |                              |
         | <--- 2. initialize result -------- |                              |
         |                                    |                              |
         | --- 3. authenticate ------------> |                              |
         | <--- 4. auth result -------------- |                              |
         |                                    |                              |
         | --- 5. session/new --------------> |                              |
         | <--- 6. sessionId + models ------- |                              |
         |                                    |                              |
         | --- 7. session/prompt -----------> | === spawn subprocess ======> |
         |                                    | <.. event: init ............ |
         |                                    | <.. event: step_update ..... |
         | <=== session/update (thought) <=== | (thought_delta)              |
         | <=== session/update (text) <====== | (text_delta)                 |
         | <=== session/update (tool_call) <= | (tool_call / tool_info)      |
         |                                    | <.. event: result .......... |
         | <--- 8. prompt result (end_turn) - | === process exited cleanly = |
```

---

## 2. 上行请求方法映射规范

### 2.1 `initialize`（能力协商）
* **客户端请求**：
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": 1,
      "clientInfo": { "name": "Zed", "version": "0.178.0" },
      "clientCapabilities": { "fs": { "read": true, "write": true }, "terminal": true }
    }
  }
  ```
* **适配器响应**：
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
      "protocolVersion": 1,
      "agentInfo": {
        "name": "antigravity-cli",
        "title": "Google Antigravity Native Engine (agy)",
        "version": "2.0.0"
      },
      "agentCapabilities": {
        "loadSession": true,
        "promptCapabilities": { "embeddedContext": true },
        "sessionCapabilities": { "close": true, "cancel": true }
      },
      "authMethods": [
        {
          "id": "google-gemini-auth",
          "name": "Google Antigravity Account",
          "description": "Reusing authenticated Google session from agy CLI"
        }
      ]
    }
  }
  ```

---

### 2.2 `session/new`（会话初始化与模型下发）
* **适配器处理**：
  - 调用 `agy models` 探测所有可用模型；
  - 返回新的 UUID 作为 `sessionId`；
  - 同时下发经典 `models` 字段（ACP v1）与 `configOptions` 数组（兼容 Zed 最新的模型选择器配置协议）。
* **适配器响应**：
  ```json
  {
    "jsonrpc": "2.0",
    "id": 2,
    "result": {
      "sessionId": "b9f1d24c-1122-48aa-b552-89ccaa500112",
      "configOptions": [
        {
          "id": "model",
          "name": "Model",
          "category": "model",
          "type": "select",
          "currentValue": "gemini-3.8-flash-high",
          "options": [
            { "value": "gemini-3.8-flash-high", "name": "Gemini 3.8 Flash (High)" },
            { "value": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6 (Thinking)" }
          ]
        }
      ],
      "models": {
        "currentModelId": "gemini-3.8-flash-high",
        "availableModels": [
          { "modelId": "gemini-3.8-flash-high", "name": "Gemini 3.8 Flash (High)" }
        ]
      }
    }
  }
  ```

---

### 2.3 `session/prompt`（提示词执行）
* **客户端请求**：
  ```json
  {
    "jsonrpc": "2.0",
    "id": 3,
    "method": "session/prompt",
    "params": {
      "sessionId": "b9f1d24c-1122-48aa-b552-89ccaa500112",
      "prompt": [
        { "type": "text", "text": "请帮我重构这段 TypeScript 代码" }
      ]
    }
  }
  ```
* **驱动底座命令**：
  ```bash
  agy.exe --output-format stream-json --dangerously-skip-permissions --model gemini-3.8-flash-high [--conversation <id>] --print "请帮我重构这段 TypeScript 代码"
  ```

---

## 3. 下行事件转译对照表（NDJSON → ACP session/update）

底座 `agy.exe` 的 `--output-format stream-json` 逐行吐出 NDJSON 事件，适配器将其准实时翻译为标准 ACP 协议的通知：

| 底座 agy.exe 事件字段 | 触发条件 | 转译为 ACP 通知 (`method: session/update`) |
| :--- | :--- | :--- |
| `event: "init"` | 启动首行握手 | 提取 `conversation_id` 并与当前 `sessionId` 双向绑定 |
| `step_type: "agent_response"`<br>`text_delta: "..."` | 普通正文打字机 | `sessionUpdate: "agent_message_chunk"`<br>`content: { type: "text", text: delta }` |
| `thought_delta: "..."` | 模型进行深度推理 | `sessionUpdate: "thought_chunk"`<br>`content: { type: "thought", text: thoughtDelta }` |
| `step_type: "tool_call"`<br>`state: "ACTIVE"` | 工具开始执行 | `sessionUpdate: "tool_call"`<br>`toolCallId: ...`<br>`title: "Running tool: view_file"` |
| `step_type: "tool_call"`<br>`state: "DONE"` | 工具执行完毕 | `sessionUpdate: "tool_call"`<br>`status: "completed"` |
| `event: "result"` | 任务回合执行完结 | 终结转译，向客户端下发 `session/prompt` 的 RPC 结果响应（附带 Token 用量） |

---

## 4. 示例：实时下行推流报文示范

当用户提问后，底座吐出思考与正文，适配器向客户端持续推送的原始 Stdio JSON-RPC 通知流如下：

### ① 推送思维链思考流
```json
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"...","update":{"sessionUpdate":"thought_chunk","content":{"type":"thought","text":"正在分析该函数的输入参数类型..."}}}}
```

### ② 推送正文增量流
```json
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"...","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"针对该函数的优化方案如下："}}}}
```

### ③ 推送工具执行状态
```json
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"...","update":{"sessionUpdate":"tool_call","toolCallId":"tool-1","title":"Running tool: view_file (server/index.ts)","status":"running"}}}
```

### ④ 回合完成响应
```json
{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
```
