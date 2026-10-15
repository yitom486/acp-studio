import { describe, it, expect, afterAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { startMcpUiServer, stopMcpUiServer, getMcpUiServerInfo } from "../../server/universal/mcp-ui-server";
import { convertAcpMessages } from "../../src/lib/acp-assistant";
import { DecisionCard, ChecklistCard, MetricsCard, PromptFormCard } from "../../src/components/assistant/GenerativeCards";
import { ReactArtifactCard } from "../../src/components/assistant/ReactArtifactCard";

describe("Universal ACP Studio - 5-Digit MCP Server & Generative UI", () => {
  afterAll(async () => {
    await stopMcpUiServer();
  });

  it("boots the 5-digit MCP server with auto-increment fallback on a dedicated port >= 10000", async () => {
    const info = await startMcpUiServer(13920);
    expect(info.port).toBeGreaterThanOrEqual(10000);
    expect(info.url).toContain(`:${info.port}/mcp`);
    expect(getMcpUiServerInfo()?.port).toBe(info.port);

    // Verify /health endpoint returns server details
    const res = await fetch(`http://127.0.0.1:${info.port}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.name).toBe("studio-ui");
    expect(data.port).toBe(info.port);
    expect(data.endpoint).toContain("/mcp");

    // Verify /mcp endpoint accepts Streamable HTTP requests
    const mcpRes = await fetch(`http://127.0.0.1:${info.port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    expect(mcpRes.status).toBe(200);
  });

  it("maps ACP generative UI tool calls with full structured args and rawOutput in convertAcpMessages", () => {
    const msg = {
      id: "msg-gen-ui",
      role: "assistant" as const,
      content: "这里是结论",
      timestamp: "12:00",
      toolCalls: [
        {
          id: "tc-card-1",
          name: "show_interactive_card",
          title: "show_interactive_card",
          status: "completed" as const,
          rawInput: {
            title: "重构技术选型",
            cardType: "decision",
            data: {
              options: [
                { id: "opt-a", label: "方案 A", recommended: true },
                { id: "opt-b", label: "方案 B" },
              ],
            },
          },
          rawOutput: { status: "ok" },
        },
        {
          id: "tc-sandbox-1",
          name: "render_react_sandbox",
          title: "render_react_sandbox",
          status: "completed" as const,
          rawInput: {
            title: "倒计时组件原型",
            code: "function App() { return <div>Timer</div>; }",
            template: "react",
          },
        },
      ],
    };

    const converted = convertAcpMessages([msg]);
    expect(converted.length).toBe(1);
    const part0 = converted[0].content[0] as any;
    expect(part0.type).toBe("tool-call");
    expect(part0.toolName).toBe("show_interactive_card");
    expect(part0.args.title).toBe("重构技术选型");
    expect(part0.args.cardType).toBe("decision");
    expect(part0.result).toEqual({ status: "ok" });

    const part1 = converted[0].content[1] as any;
    expect(part1.type).toBe("tool-call");
    expect(part1.toolName).toBe("render_react_sandbox");
    expect(part1.args.code).toContain("Timer");
  });

  it("renders Generative UI decision, checklist, metrics, and prompt form components smoothly", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement("div", null, [
          React.createElement(DecisionCard, {
            key: "dec",
            title: "发布目标环境",
            description: "选择部署集群",
            options: [
              { id: "prod", label: "生产环境", recommended: true },
              { id: "staging", label: "预发环境" },
            ],
          }),
          React.createElement(ChecklistCard, {
            key: "chk",
            title: "发布检查清单",
            items: [
              { id: "build", label: "打包通过", checked: true },
              { id: "tests", label: "门禁测试", checked: false },
            ],
          }),
          React.createElement(MetricsCard, {
            key: "met",
            title: "系统指标",
            metrics: [
              { label: "吞吐量", value: "1,200", unit: "req/s" },
              { label: "P99 延迟", value: "12", unit: "ms" },
            ],
          }),
          React.createElement(PromptFormCard, {
            key: "form",
            title: "数据库连接配置",
            fields: [
              { id: "host", label: "主机地址", defaultValue: "127.0.0.1" },
              { id: "port", label: "端口号", defaultValue: 5432 },
            ],
          }),
        ])
      );
    });

    expect(container.textContent).toContain("发布目标环境");
    expect(container.textContent).toContain("生产环境");
    expect(container.textContent).toContain("推荐");
    expect(container.textContent).toContain("发布检查清单");
    expect(container.textContent).toContain("打包通过");
    expect(container.textContent).toContain("系统指标");
    expect(container.textContent).toContain("吞吐量");
    expect(container.textContent).toContain("数据库连接配置");
    expect(container.textContent).toContain("主机地址");

    act(() => root.unmount());
    container.remove();
  });

  it("renders ReactArtifactCard with iframe sandbox='allow-scripts' without leaking privileges", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(ReactArtifactCard, {
          code: "function App() { return <div>Hello Sandbox</div>; }",
          template: "react",
          title: "测试组件",
        })
      );
    });

    expect(container.textContent).toContain("测试组件");
    expect(container.textContent?.toLowerCase()).toContain("react");

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // Invariant: sandbox must be allow-scripts and strictly NEVER allow-same-origin
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");

    act(() => root.unmount());
    container.remove();
  });
});
