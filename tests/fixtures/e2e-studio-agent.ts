import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Model decisions are scripted; MCP discovery and tool execution use the real server.
const sessions = new Map<string, { mcpServers: any[]; presented?: "decision" | "form" }>();
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
    const form = fullText.includes("表单") || fullText.includes("部署参数");
    const name = form ? "prompt_form" : "show_interactive_card";
    const args = form ? {
      title: "服务部署参数", submitLabel: "确认并部署",
      fields: [
        { id: "cluster_name", label: "集群名称", type: "text", defaultValue: "prod-cluster-01", required: true },
        { id: "replicas", label: "副本数量", type: "number", defaultValue: 3, required: true },
      ],
    } : {
      title: "高可用服务架构选型", cardType: "decision",
      data: { options: [
        { id: "opt-event-driven", label: "事件驱动微服务 (Kafka + Go)", recommended: true },
        { id: "opt-monolith", label: "经典单体架构 (Postgres + Node)" },
      ] },
    };
    const rawOutput = await callStudio(sessionId, name, args);
    state.presented = form ? "form" : "decision";
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
