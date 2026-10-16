import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Model decisions are scripted; MCP discovery and tool execution use the real server.
const sessions = new Map<string, { mcpServers: any[]; presented?: string }>();
let sequence = 0;
const modelState = {
  models: { currentModelId: "e2e-default", availableModels: [{ id: "e2e-default", name: "E2E Test Model" }] },
  modes: { currentModeId: "agent", availableModes: [{ id: "agent", name: "Agent Mode" }] },
};

async function callStudio(sessionId: string, name: string, args: Record<string, unknown>) {
  const endpoint = sessions.get(sessionId)?.mcpServers.find((server) => server.name === "studio-ui");
  if (!endpoint?.url) throw new Error("studio-ui was not injected into session/new");
  const client = new Client({ name: "e2e-studio-agent", version: "1.0.0" });
  try {
    const headers = Object.fromEntries((endpoint.headers || []).map((h: any) => [h.name, h.value]));
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers } }));
    const catalog = await client.listTools();
    if (!catalog.tools.some((tool) => tool.name === name)) throw new Error(`MCP tool missing: ${name}`);
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(`MCP tool failed: ${JSON.stringify(result)}`);
    return result;
  } finally { await client.close(); }
}

async function text(ctx: any, sessionId: string, value: string) {
  await ctx.client.notify(acp.methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: value } },
  });
}

const app = acp.agent({ name: "e2e-agent", version: "1.0.0" })
  .onRequest(acp.methods.agent.initialize, async () => ({
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} }, mcpCapabilities: { http: true } },
    agentInfo: { name: "e2e-agent", title: "E2E Test Agent", version: "1.0.0" },
    authMethods: [],
  }))
  .onRequest(acp.methods.agent.session.list, async () => ({
    sessions: [...sessions.keys()].map((sessionId) => ({ sessionId, cwd: process.cwd() })),
  }))
  .onRequest(acp.methods.agent.session.new, async (ctx: any) => {
    const sessionId = `e2e-session-${++sequence}`;
    sessions.set(sessionId, { mcpServers: ctx.params.mcpServers || [] });
    if (process.env.ACP_E2E_SESSION_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.ACP_E2E_SESSION_DELAY_MS)));
    return { sessionId, ...modelState };
  })
  .onRequest(acp.methods.agent.session.load, async (ctx: any) => {
    if (!sessions.has(ctx.params.sessionId)) throw new Error("Unknown session");
    return { ...modelState };
  })
  .onRequest(acp.methods.agent.session.prompt, async (ctx: any) => {
    const { sessionId, prompt } = ctx.params;
    const state = sessions.get(sessionId);
    if (!state) throw new Error("Unknown session");
    const fullText = prompt.map((block: any) => block.text || "").join(" ");
    // Submit markers precede broad keywords so follow-ups do not regenerate cards.
    if (fullText.includes("[方案决策:")) {
      if (state.presented !== "decision") throw new Error("Decision submitted to the wrong session");
      await text(ctx, sessionId, `【ACP 会话继续执行】已确认收到您选定的方案！ session=${sessionId}\n${fullText.split("用户已选定方案：")[1]}`);
      return { stopReason: "end_turn" };
    }
    if (fullText.includes("[表单提交:")) {
      if (state.presented !== "form") throw new Error("Form submitted to the wrong session");
      await text(ctx, sessionId, `【ACP 会话继续执行】部署参数已提交验证，正在初始化集群副本！ session=${sessionId}\n${fullText.slice(fullText.indexOf("\n") + 1)}`);
      return { stopReason: "end_turn" };
    }

    let name = "show_interactive_card";
    let args: Record<string, unknown> = {};

    if (fullText.includes("时序") || fullText.includes("sequence")) {
      name = "render_editorial_diagram";
      state.presented = "diagram";
      args = {
        title: "微服务调用链路时序图",
        diagramType: "sequence",
        description: "客户端网关与鉴权中心时序链路",
        theme: "system",
        accent: "emerald",
        data: {
          steps: [
            { source: "Browser", target: "Gateway", label: "POST /login" },
            { source: "Gateway", target: "AuthService", label: "Verify Credentials" },
            { source: "AuthService", target: "Gateway", label: "Issue JWT Token" },
          ],
        },
      };
    } else if (fullText.includes("流程") || fullText.includes("状态机") || fullText.includes("flowchart")) {
      name = "render_editorial_diagram";
      state.presented = "flowchart";
      args = {
        title: "订单履约业务状态流转图",
        diagramType: "flowchart",
        description: "订单创建至配送完成的业务状态机",
        theme: "system",
        accent: "emerald",
        data: {
          steps: [
            { id: "created", label: "订单已创建", description: "待买家支付", status: "已完成" },
            { id: "paid", label: "在线支付成功", description: "资金渠道对账中", status: "进行中", isCurrent: true },
            { id: "stock", label: "仓储打包出库", description: "WMS 自动化分拣", status: "等待" },
            { id: "delivery", label: "顺丰冷链配送", description: "预计明日送达", status: "等待" },
          ],
          connections: [
            { from: "created", to: "paid" },
            { from: "paid", to: "stock" },
            { from: "stock", to: "delivery" },
          ],
        },
      };
    } else if (fullText.includes("架构图") || fullText.includes("分层架构") || fullText.includes("architecture")) {
      name = "render_editorial_diagram";
      state.presented = "architecture";
      args = {
        title: "微服务分层系统架构图",
        diagramType: "architecture",
        description: "生产环境分层微服务拓扑结构",
        theme: "system",
        accent: "emerald",
        data: {
          layers: [
            {
              id: "gateway-layer",
              title: "接入网关层",
              nodes: [
                { id: "kong", label: "Kong Gateway", subtext: "反向代理 & 鉴权", highlighted: true },
                { id: "waf", label: "Cloudflare WAF", subtext: "DDoS 防护" },
              ],
            },
            {
              id: "service-layer",
              title: "业务服务层",
              nodes: [
                { id: "auth-svc", label: "Auth Service", subtext: "JWT & OAuth2" },
                { id: "order-svc", label: "Order Service", subtext: "订单状态机", highlighted: true },
              ],
            },
            {
              id: "data-layer",
              title: "数据持久层",
              nodes: [
                { id: "pg", label: "PostgreSQL 主从", subtext: "OLTP 存储" },
                { id: "redis", label: "Redis Cluster", subtext: "分布式缓存" },
              ],
            },
          ],
          connections: [
            { from: "gateway-layer", to: "service-layer" },
            { from: "service-layer", to: "data-layer" },
          ],
        },
      };
    } else if (fullText.includes("清单") || fullText.includes("检查项") || fullText.includes("checklist")) {
      name = "show_interactive_card";
      state.presented = "checklist";
      args = {
        title: "系统上线前安全门禁清单",
        cardType: "checklist",
        description: "生产发布前必须逐项核对确认",
        data: {
          items: [
            { id: "db_backup", label: "数据库快照已完成备份", checked: true },
            { id: "ssl_cert", label: "HTTPS 证书有效性校验", checked: false },
            { id: "firewall", label: "网关 WAF 安全策略启用", checked: false },
          ],
        },
      };
    } else if (fullText.includes("指标") || fullText.includes("监控") || fullText.includes("metrics")) {
      name = "show_interactive_card";
      state.presented = "metrics";
      args = {
        title: "微服务核心运行指标看板",
        cardType: "metrics",
        description: "生产集群最近 1 小时关键监控指标汇总",
        data: {
          metrics: [
            { label: "平均响应时延 P99", value: "12.4", unit: "ms", change: "-8.5%", progress: 75 },
            { label: "QPS 吞吐量", value: "85,400", unit: "req/s", change: "+14.2%", progress: 85 },
            { label: "错误率 (Error Rate)", value: "0.01", unit: "%", change: "-0.05%", progress: 10 },
          ],
        },
      };
    } else if (fullText.includes("沙箱") || fullText.includes("自由组件") || fullText.includes("sandbox")) {
      name = "render_react_sandbox";
      state.presented = "sandbox";
      args = {
        title: "实时计数器原型",
        description: "包含实时计数与增减交互的 React 沙箱原型",
        template: "react",
        code: `function App() {
  const [count, setCount] = React.useState(0);
  return (
    <div style={{ padding: "16px", color: "#fff" }}>
      <h4>计数器: {count}</h4>
      <button onClick={() => setCount(count + 1)}>增加</button>
    </div>
  );
}`,
      };
    } else if (fullText.includes("表单") || fullText.includes("部署参数")) {
      name = "prompt_form";
      state.presented = "form";
      args = {
        title: "服务部署参数",
        submitLabel: "确认并部署",
        fields: [
          { id: "cluster_name", label: "集群名称", type: "text", defaultValue: "prod-cluster-01", required: true },
          { id: "replicas", label: "副本数量", type: "number", defaultValue: 3, required: true },
        ],
      };
    } else {
      name = "show_interactive_card";
      state.presented = "decision";
      args = {
        title: "高可用服务架构选型",
        cardType: "decision",
        data: {
          options: [
            { id: "opt-event-driven", label: "事件驱动微服务 (Kafka + Go)", recommended: true },
            { id: "opt-monolith", label: "经典单体架构 (Postgres + Node)" },
          ],
        },
      };
    }

    const rawOutput = await callStudio(sessionId, name, args);
    // No rawInput: rendering must consume the actual MCP result.
    await ctx.client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "tool_call", toolCallId: `e2e-${sessionId}-${state.presented}`,
        name, title: name, status: "completed", rawOutput,
      },
    });
    await text(ctx, sessionId, `真实 MCP ${name} 已返回。 session=${sessionId}`);
    return { stopReason: "end_turn" };
  });

app.connect(acp.ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
));
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
