# Antigravity ACP 项目文档索引目录

欢迎查阅 **Google Antigravity ACP (Agent Client Protocol) 适配器** 文档库。本项目旨在将 Google 官方原生 CLI（`agy.exe`）封装为符合标准 ACP 协议的智能体服务，供 **Zed 编辑器**、**Inkdown HUD** 以及 **Web Studio** 直接驱动，彻底解决原版服务解压临时文件吃满 C 盘的痛点。

---

## 📚 文档导读指引

| 文档编号 | 文档名称 | 核心内容与面向读者 | 快捷直达链接 |
| :--- | :--- | :--- | :--- |
| **00** | **核心总览与 Zed 完全手册** | 🌟 **推荐首读**。30秒快速在 Zed 中配置使用、为什么旧方案吃满 C 盘、全链路原理拆解、双端共生方案与实测 FAQ。 | [00_master_guide_and_zed_faq.md](file:///d:/project/js/Electron/antigravity-acp/docs/00_master_guide_and_zed_faq.md) |
| **01** | **架构原理与方案论证** | 深入剖析 PyInstaller `--onefile` 机制、对比剖析 3 个社区开源方案（shindgew、shubzkothekar、hicder），阐述双模引擎架构设计。 | [01_architecture_and_principles.md](file:///d:/project/js/Electron/antigravity-acp/docs/01_architecture_and_principles.md) |
| **02** | **Zed 编辑器接入专刊** | 专注于 Zed 编辑器的配置参数细节、`settings.json` 的 `agent_servers` 写法、`run-zed-acp.cmd` 与管道防污染原则。 | [02_zed_integration_guide.md](file:///d:/project/js/Electron/antigravity-acp/docs/02_zed_integration_guide.md) |
| **03** | **协议转译与事件映射规范** | 详尽的协议双向映射字典：ACP JSON-RPC 2.0 方法与 Google `agy` CLI `stream-json`（NDJSON）事件字段的逐一转换对照表。 | [03_protocol_and_mapping_spec.md](file:///d:/project/js/Electron/antigravity-acp/docs/03_protocol_and_mapping_spec.md) |
| **04** | **认证机制与会话生命周期白皮书** | 系统分析 Google Antigravity 本地凭证继承原理、会话隔离、进程生命周期守护、异常退出回收机制与安全策略。 | [antigravity_acp_auth_and_lifecycle.md](file:///d:/project/js/Electron/antigravity-acp/docs/antigravity_acp_auth_and_lifecycle.md) |

---

## 🚀 极速启动备忘

### 场景 A：在 Zed 编辑器中使用（Stdio 模式，免开端口，100% 零黑框）
直接在 Zed 的 `settings.json` 中配置：
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

### 场景 B：启动 HTTP / SSE 守护服务（供 Inkdown HUD / Web 使用）
在项目目录下执行：
```bash
bun run server/index.ts
# 或启动完整全栈开发界面
bun run dev
```
服务将在 `http://localhost:3004` 启动，提供标准 REST API 与 SSE 事件流。
