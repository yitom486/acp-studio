/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import {
  normalizeGenerativeToolName,
  isGenerativeTool,
  extractToolArgs,
  AcpGenerativeToolCard,
} from "../../src/components/assistant/toolkit";

describe("Generative UI - Live OpenCode End-to-End Simulation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("OpenCode Live 1: parses and renders Editorial Diagram from JS call syntax", async () => {
    const opencodeDiagramTool = {
      id: "call_01a1b2c3d4",
      title:
        'await tools["studio-ui"].render_editorial_diagram({ title: "OAuth2 PKCE 授权码时序", diagramType: "sequence", data: { steps: [{ source: "Browser", target: "Gateway", label: "GET /authorize" }, { source: "Gateway", target: "AuthServer", label: "Verify PKCE Challenge" }] } })',
      status: "completed" as const,
      rawOutput: {
        content: [
          {
            type: "text",
            text: '[EditorialDiagram: sequence] "OAuth2 PKCE 授权码时序" 已成功渲染出版级矢量图表。',
          },
        ],
        data: {
          title: "OAuth2 PKCE 授权码时序",
          diagramType: "sequence",
          description: "OAuth2 + PKCE 安全认证时序全链路",
          data: {
            steps: [
              { source: "Browser", target: "Gateway", label: "GET /authorize" },
              { source: "Gateway", target: "AuthServer", label: "Verify PKCE Challenge" },
            ],
          },
        },
      },
    };

    // 1. Tool name normalization and identification
    expect(normalizeGenerativeToolName(opencodeDiagramTool.title)).toBe("render_editorial_diagram");
    expect(isGenerativeTool(opencodeDiagramTool)).toBe(true);

    // 2. Argument extraction handles both title JS string and rawOutput.data
    const extracted = extractToolArgs(opencodeDiagramTool);
    expect(extracted.title).toBe("OAuth2 PKCE 授权码时序");
    expect(extracted.diagramType).toBe("sequence");

    // 3. Mount component and verify rendered SVG and metadata
    await act(async () => {
      root.render(<AcpGenerativeToolCard tool={opencodeDiagramTool} />);
    });

    expect(container.textContent).toContain("OAuth2 PKCE 授权码时序");
    expect(container.textContent).toContain("交互时序图");
    expect(container.textContent).toContain("Browser");
    expect(container.textContent).toContain("Gateway");
    expect(container.textContent).toContain("AuthServer");
    expect(container.textContent).toContain("GET /authorize");

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("OpenCode Live 2: parses and renders Decision Card from JS call syntax and interactive selection", async () => {
    const opencodeDecisionTool = {
      id: "call_02b3c4d5e6",
      title:
        'await tools["studio-ui"].show_interactive_card({ title: "构建方案选型: Vite vs Turbopack", cardType: "decision", data: { options: [{ id: "vite", label: "维持 Vite", recommended: true, description: "生态成熟无缝" }, { id: "turbopack", label: "迁移 Turbopack", description: "Rust 增量优势" }] } })',
      status: "completed" as const,
      rawOutput: {
        data: {
          title: "构建方案选型: Vite vs Turbopack",
          cardType: "decision",
          data: {
            options: [
              { id: "vite", label: "维持 Vite", recommended: true, description: "生态成熟无缝" },
              { id: "turbopack", label: "迁移 Turbopack", description: "Rust 增量优势" },
            ],
          },
        },
      },
    };

    expect(normalizeGenerativeToolName(opencodeDecisionTool.title)).toBe("show_interactive_card");
    expect(isGenerativeTool(opencodeDecisionTool)).toBe(true);

    const onAction = vi.fn();
    await act(async () => {
      root.render(<AcpGenerativeToolCard tool={opencodeDecisionTool} onAction={onAction} />);
    });

    expect(container.textContent).toContain("构建方案选型: Vite vs Turbopack");
    expect(container.textContent).toContain("维持 Vite");
    expect(container.textContent).toContain("迁移 Turbopack");
    expect(container.textContent).toContain("推荐");

    // Click on option
    const viteOpt = Array.from(container.querySelectorAll("div")).find(
      (el) => el.textContent?.includes("维持 Vite") && el.classList.contains("cursor-pointer")
    );
    expect(viteOpt).toBeDefined();

    await act(async () => {
      viteOpt?.click();
    });

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "decision",
        choiceId: "vite",
        choiceLabel: "维持 Vite",
      })
    );
  });

  it("OpenCode Live 3: parses and renders Prompt Form from JS call syntax", async () => {
    const opencodeFormTool = {
      id: "call_03c4d5e6f7",
      title:
        'tools["studio-ui"].prompt_form({ title: "Redis 服务配置", fields: [{ id: "host", label: "Redis 主机", type: "text" }, { id: "port", label: "端口", type: "number" }, { id: "password", label: "密码", type: "text" }, { id: "db", label: "DB 编号", type: "number" }] })',
      status: "completed" as const,
      rawOutput: {
        data: {
          title: "Redis 服务配置",
          fields: [
            { id: "host", label: "Redis 主机", type: "text" },
            { id: "port", label: "端口", type: "number" },
            { id: "password", label: "密码", type: "text" },
            { id: "db", label: "DB 编号", type: "number" },
          ],
        },
      },
    };

    expect(normalizeGenerativeToolName(opencodeFormTool.title)).toBe("prompt_form");
    expect(isGenerativeTool(opencodeFormTool)).toBe(true);

    await act(async () => {
      root.render(<AcpGenerativeToolCard tool={opencodeFormTool} />);
    });

    expect(container.textContent).toContain("Redis 服务配置");
    expect(container.textContent).toContain("Redis 主机");
    expect(container.textContent).toContain("端口");
    expect(container.textContent).toContain("密码");
    expect(container.textContent).toContain("DB 编号");

    const submitBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("提交并继续")
    );
    expect(submitBtn).toBeDefined();
  });

  it("OpenCode Live 4: correctly filters generative tools away from regular tools accordion", () => {
    const toolCalls = [
      {
        id: "call_skill",
        title: 'const doc = await tools["studio-ui"].get_studio_skill({ name: "diagram-design" })',
        status: "completed" as const,
      },
      {
        id: "call_diagram",
        title: 'await tools["studio-ui"].render_editorial_diagram({ title: "OAuth2 PKCE", diagramType: "sequence" })',
        status: "completed" as const,
      },
      {
        id: "call_cmd",
        title: "pwd",
        status: "completed" as const,
      },
    ];

    const generativeTools = toolCalls.filter((tc) => isGenerativeTool(tc));
    const regularTools = toolCalls.filter((tc) => !isGenerativeTool(tc));

    expect(generativeTools).toHaveLength(1);
    expect(generativeTools[0].id).toBe("call_diagram");

    expect(regularTools).toHaveLength(2);
    expect(regularTools.map((t) => t.id)).toEqual(["call_skill", "call_cmd"]);
  });

  it("OpenCode Live 5: namespaced tool name + missing diagramType still renders a flowchart card", async () => {
    // 还原真实故障：真 agent 发 studio-ui__ 双下划线命名，且经常不带 diagramType。
    // 修之前：isGenerativeTool=false（掉进普通工具行）；即使认出也默认画成 architecture。
    const namespacedFlowchartTool = {
      id: "call_01redis",
      name: "studio-ui__render_editorial_diagram",
      title: "Redis 缓存加速流程",
      status: "completed" as const,
      rawInput: {
        title: "Redis 缓存加速流程",
        data: {
          steps: [
            { id: "req", label: "请求接入" },
            { id: "redis", label: "查 Redis" },
            { id: "db", label: "未命中查 DB" },
            { id: "backfill", label: "回写并设过期" },
          ],
        },
      },
    };

    expect(isGenerativeTool(namespacedFlowchartTool)).toBe(true);

    await act(async () => {
      root.render(<AcpGenerativeToolCard tool={namespacedFlowchartTool} />);
    });

    expect(container.textContent).toContain("Redis 缓存加速流程");
    // 推断出 flowchart 而非默认 architecture
    expect(container.textContent).toContain("流程与状态机");
    expect(container.textContent).toContain("请求接入");
    expect(container.textContent).toContain("查 Redis");
    expect(container.textContent).not.toContain("系统架构分层");

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });
});
