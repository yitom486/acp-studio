import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import { UniversalAgentConnection } from "../../server/universal/AgentConnection";
import { startMcpUiServer, stopMcpUiServer, getMcpUiServerInfo } from "../../server/universal/mcp-ui-server";

describe("MCP Integration Pipeline - Mock LLM Agent Tool Calls & Auto-Injection", () => {
  let conn: UniversalAgentConnection;
  const fixturePath = path.resolve(__dirname, "../fixtures/mock-acp-agent.ts");

  beforeAll(async () => {
    // 1. Ensure 5-digit MCP server is running
    await startMcpUiServer(13920);

    // 2. Connect to Deterministic Mock ACP Agent
    conn = new UniversalAgentConnection({
      id: "mock-gen-agent",
      name: "Mock Generative Agent",
      command: process.platform === "win32" ? "bun.exe" : "bun",
      args: ["run", fixturePath],
    });
    await conn.connect();
  });

  afterAll(async () => {
    await conn.disconnect();
    await stopMcpUiServer();
  });

  it("verifies 5-digit MCP server auto-injection into session/new request to agent", async () => {
    const mcpInfo = getMcpUiServerInfo();
    expect(mcpInfo).not.toBeNull();
    expect(mcpInfo!.port).toBeGreaterThanOrEqual(10000);

    const sessionRes: any = await conn.newSession({
      cwd: process.cwd(),
      mcpServers: [{ name: "custom-user-mcp", command: "test", args: [], env: [] }],
    });

    expect(sessionRes).toHaveProperty("sessionId");
    const sid = sessionRes.sessionId;

    // Trigger session inspection scenario on mock agent to verify what mcpServers were received
    const replayed: any[] = [];
    await conn.prompt(
      sid,
      [{ type: "text", text: "trigger_inspect_session" }],
      (evt: any) => {
        if (evt.type === "update") replayed.push(evt.update);
      }
    );

    const chunk = replayed.find((u) => u.sessionUpdate === "agent_message_chunk");
    expect(chunk).toBeDefined();
    const inspected = JSON.parse(chunk.content.text);

    // Assert that studio-ui was automatically injected alongside user mcp servers!
    const studioMcp = inspected.mcpServers.find((s: any) => s.name === "studio-ui");
    expect(studioMcp).toBeDefined();
    expect(studioMcp.type).toBe("sse");
    expect(studioMcp.url).toContain(`:${mcpInfo!.port}/sse`);

    const customMcp = inspected.mcpServers.find((s: any) => s.name === "custom-user-mcp");
    expect(customMcp).toBeDefined();
  });

  it("simulates mock LLM output stream delivering full set of Generative UI tool calls", async () => {
    const sessionRes: any = await conn.newSession({ cwd: process.cwd() });
    const sid = sessionRes.sessionId;

    const collectedUpdates: any[] = [];

    // Trigger the mock LLM generative UI tool call sequence
    const result: any = await conn.prompt(
      sid,
      [{ type: "text", text: "trigger_generative_ui" }],
      (evt: any) => {
        if (evt.type === "update") collectedUpdates.push(evt.update);
      }
    );

    expect(result.stopReason).toBe("end_turn");

    // Extract all tool_call updates
    const toolCalls = collectedUpdates.filter((u) => u.sessionUpdate === "tool_call");
    expect(toolCalls.length).toBe(5);

    // 1. Verify Decision Card tool call
    const decisionTc = toolCalls.find((t) => t.toolCallId === "tc-gen-decision");
    expect(decisionTc).toBeDefined();
    expect(decisionTc.name).toBe("show_interactive_card");
    expect(decisionTc.rawInput.title).toBe("微服务部署架构决策");
    expect(decisionTc.rawInput.cardType).toBe("decision");
    expect(decisionTc.rawInput.data.options.length).toBe(2);
    expect(decisionTc.rawInput.data.options[0].recommended).toBe(true);

    // 2. Verify Checklist Card tool call
    const checklistTc = toolCalls.find((t) => t.toolCallId === "tc-gen-checklist");
    expect(checklistTc).toBeDefined();
    expect(checklistTc.name).toBe("show_interactive_card");
    expect(checklistTc.rawInput.title).toBe("发布前门禁校验");
    expect(checklistTc.rawInput.cardType).toBe("checklist");
    expect(checklistTc.rawInput.data.items.length).toBe(3);

    // 3. Verify Metrics Card tool call
    const metricsTc = toolCalls.find((t) => t.toolCallId === "tc-gen-metrics");
    expect(metricsTc).toBeDefined();
    expect(metricsTc.name).toBe("show_interactive_card");
    expect(metricsTc.rawInput.cardType).toBe("metrics");
    expect(metricsTc.rawInput.data.metrics.length).toBe(3);

    // 4. Verify Prompt Form tool call
    const formTc = toolCalls.find((t) => t.toolCallId === "tc-gen-form");
    expect(formTc).toBeDefined();
    expect(formTc.name).toBe("prompt_form");
    expect(formTc.rawInput.title).toBe("数据库配置向导");
    expect(formTc.rawInput.fields.length).toBe(3);

    // 5. Verify React Sandbox tool call
    const sandboxTc = toolCalls.find((t) => t.toolCallId === "tc-gen-sandbox");
    expect(sandboxTc).toBeDefined();
    expect(sandboxTc.name).toBe("render_react_sandbox");
    expect(sandboxTc.rawInput.title).toBe("动态计数器原型");
    expect(sandboxTc.rawInput.template).toBe("react");
    expect(sandboxTc.rawInput.code).toContain("计数器原型");

    // Verify final message chunk
    const textChunk = collectedUpdates.find((u) => u.sessionUpdate === "agent_message_chunk");
    expect(textChunk).toBeDefined();
    expect(textChunk.content.text).toContain("已为您生成全套生成式 UI 交互卡片");
  });
});
