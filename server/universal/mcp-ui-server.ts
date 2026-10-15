/**
 * Universal ACP Studio Built-in MCP Server for Generative UI.
 *
 * Runs an SSE-based Model Context Protocol (MCP) server on a dedicated 5-digit port
 * (default starting at 13920, automatically cascading up if occupied).
 *
 * Exposes core interactive tools:
 * - `show_interactive_card`: Structured cards (forms, decisions, metrics, checklists).
 * - `render_react_sandbox`: Arbitrary React / HTML sandboxed interactive prototypes.
 * - `prompt_form`: Human-in-the-loop interactive form inputs.
 */
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export interface McpServerInfo {
  port: number;
  url: string;
  name: string;
  version: string;
}

let activeServer: http.Server | null = null;
let activeInfo: McpServerInfo | null = null;
let activeTransport: StreamableHTTPServerTransport | null = null;
let activeMcp: McpServer | null = null;

export function getMcpUiServerInfo(): McpServerInfo | null {
  return activeInfo;
}

/**
 * Creates the McpServer instance with registered Generative UI tools.
 */
export function createMcpUiServer(): McpServer {
  const mcp = new McpServer({
    name: "studio-ui",
    version: "1.0.0",
  });

  // 1. 结构化富交互卡片（决策、指标、核对清单、表单）
  mcp.tool(
    "show_interactive_card",
    {
      title: z.string().describe("卡片展示标题"),
      cardType: z
        .enum(["decision", "metrics", "checklist", "form"])
        .describe("卡片种类：decision(方案决策)、metrics(关键指标与对比)、checklist(步骤勾选清单)、form(通用表单)"),
      description: z.string().optional().describe("卡片简要说明或辅助文案"),
      data: z
        .record(z.string(), z.unknown())
        .describe("卡片对应数据结构（例如 options 选项列表、items 清单数组、metrics 统计指标对象）"),
    },
    async ({ title, cardType, description, data }) => {
      return {
        content: [
          {
            type: "text",
            text: `[InteractiveCard: ${cardType}] "${title}" 已成功在前端聊天窗口中呈现。`,
          },
        ],
        data: { title, cardType, description, data },
      };
    }
  );

  // 2. 自由 React / HTML 沙箱预览
  mcp.tool(
    "render_react_sandbox",
    {
      title: z.string().describe("沙箱组件原型标题"),
      code: z.string().describe("完整的 React TSX/JSX 代码或 HTML+JS 原型代码"),
      template: z
        .enum(["react", "html"])
        .default("react")
        .describe("组件模板类型：'react'（自动注入 React/Tailwind 运行时）或 'html'"),
      description: z.string().optional().describe("组件功能与交互亮点说明"),
    },
    async ({ title, template, description }) => {
      return {
        content: [
          {
            type: "text",
            text: `[ReactSandbox: ${template}] "${title}" 已成功在安全隔离沙箱中加载并挂载到聊天流中。`,
          },
        ],
        data: { title, template, description },
      };
    }
  );

  // 3. 人机协同表单输入
  mcp.tool(
    "prompt_form",
    {
      title: z.string().describe("表单标题"),
      description: z.string().optional().describe("表单目的说明与操作指引"),
      submitLabel: z.string().default("提交并继续").describe("提交按钮文字"),
      fields: z
        .array(
          z.object({
            id: z.string().describe("字段 key"),
            label: z.string().describe("字段标签"),
            type: z
              .enum(["text", "number", "select", "checkbox", "textarea"])
              .default("text")
              .describe("字段输入控件类型"),
            placeholder: z.string().optional().describe("占位提示文本"),
            options: z.array(z.string()).optional().describe("select 类型的候选项列表"),
            defaultValue: z.unknown().optional().describe("默认填充值"),
            required: z.boolean().default(false).describe("是否必填"),
          })
        )
        .describe("待填写的表单字段集合"),
    },
    async ({ title, fields }) => {
      return {
        content: [
          {
            type: "text",
            text: `[PromptForm] "${title}" 已向用户下发表单（共 ${fields.length} 个字段），等待用户操作。`,
          },
        ],
        data: { title, fields },
      };
    }
  );

  // 4. 出版级精美图表（Editorial Diagram - Architecture, Sequence, Flowchart, Quadrant, Timeline）
  mcp.tool(
    "render_editorial_diagram",
    {
      title: z.string().describe("图表主标题"),
      description: z.string().optional().describe("图表副标题或背景说明"),
      diagramType: z
        .enum(["architecture", "sequence", "flowchart", "quadrant", "timeline"])
        .describe(
          "图表类型：architecture(系统架构与分层容器)、sequence(交互时序图)、flowchart(流程与状态机)、quadrant(四象限技术选型/决策矩阵)、timeline(演进里程碑)"
        ),
      theme: z
        .enum(["light", "dark", "system"])
        .default("system")
        .describe("图表主题：light(浅色纸面风格)、dark(深色黑曜石风格)、system(跟随主界面)"),
      accent: z
        .enum(["emerald", "blue", "indigo", "violet", "amber", "rose", "cyan"])
        .default("emerald")
        .describe("单一聚焦主强调色（遵循 1-Accent 聚焦原则，仅用于凸显核心路径或高亮节点）"),
      data: z
        .record(z.string(), z.unknown())
        .describe(
          "结构化图表数据：例如 architecture 包含 layers 和 connections；sequence 包含 participants 和 messages；flowchart 包含 steps 和 connections；quadrant 包含 xAxis、yAxis 和 items；timeline 包含 milestones"
        ),
    },
    async ({ title, diagramType, description, theme, accent, data }) => {
      return {
        content: [
          {
            type: "text",
            text: `[EditorialDiagram: ${diagramType}] "${title}" 已成功渲染出版级矢量图表。`,
          },
        ],
        data: { title, diagramType, description, theme, accent, data },
      };
    }
  );

  return mcp;
}

/**
 * Attempts to listen on a port. If occupied (EADDRINUSE), increments and tries next port.
 */
async function listenWithCascade(
  server: http.Server,
  startPort: number,
  maxAttempts = 30
): Promise<number> {
  let port = startPort;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: any) => {
          server.removeListener("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });
      return port;
    } catch (err: any) {
      if (err.code === "EADDRINUSE") {
        console.warn(`[MCP Server] 端口 ${port} 已被占用，自动顺延到 ${port + 1}...`);
        port++;
      } else {
        throw err;
      }
    }
  }
  throw new Error(`[MCP Server] 无法在端口 ${startPort} 到 ${port} 范围内找到可用端口。`);
}

/**
 * Starts the dedicated 5-digit MCP Server.
 */
export async function startMcpUiServer(
  preferredPort = 13920
): Promise<McpServerInfo> {
  if (activeInfo && activeServer) {
    return activeInfo;
  }

  const mcp = createMcpUiServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcp.connect(transport);
  activeTransport = transport;
  activeMcp = mcp;

  const httpServer = http.createServer(async (req, res) => {
    // 允许本地跨域
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Requested-With, Mcp-Session-Id, Mcp-Protocol-Version");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const host = req.headers.host || "127.0.0.1";
    const url = new URL(req.url || "/", `http://${host}`);

    // 健康检查与服务信息
    if (url.pathname === "/" || url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          name: "studio-ui",
          version: "1.0.0",
          port: activeInfo?.port,
          endpoint: activeInfo?.url,
        })
      );
      return;
    }

    // Streamable HTTP 单端点（MCP 2025 官方最新主流规范，统一支持直连 JSON-RPC 与双向流式推流）
    if (url.pathname === "/mcp") {
      try {
        let parsedBody: unknown = undefined;
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }
          const raw = Buffer.concat(chunks).toString("utf-8");
          if (raw.trim()) {
            try {
              parsedBody = JSON.parse(raw);
            } catch {
              // 由 transport 处理解析异常
            }
          }
        }
        await transport.handleRequest(req, res, parsedBody);
      } catch (err: any) {
        console.error("[MCP Server] Streamable HTTP request error:", err);
        if (!res.headersSent) {
          res.writeHead(500).end("Streamable HTTP error");
        }
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  });

  const parsedPort = process.env.MCP_PORT
    ? parseInt(process.env.MCP_PORT, 10)
    : preferredPort;

  const boundPort = await listenWithCascade(httpServer, parsedPort);
  activeServer = httpServer;
  activeInfo = {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/mcp`,
    name: "studio-ui",
    version: "1.0.0",
  };

  console.log(`[MCP Server] Studio UI MCP Server running at ${activeInfo.url} (Streamable HTTP)`);
  return activeInfo;
}

/**
 * Gracefully shuts down the MCP UI Server.
 */
export async function stopMcpUiServer(): Promise<void> {
  if (!activeServer) return;

  if (activeTransport) {
    try {
      await activeTransport.close();
    } catch {}
    activeTransport = null;
  }
  if (activeMcp) {
    try {
      await activeMcp.close();
    } catch {}
    activeMcp = null;
  }

  await new Promise<void>((resolve) => {
    activeServer?.close(() => resolve());
  });

  activeServer = null;
  activeInfo = null;
  console.log("[MCP Server] Studio UI MCP Server stopped.");
}
