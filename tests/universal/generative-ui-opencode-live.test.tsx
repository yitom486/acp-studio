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

  it("OpenCode Live 6: exact user screenshot tool call with JS expression title renders flowchart card", async () => {
    // 100% 还原用户截图中 OpenCode 下发的完整调用
    const userScreenshotTool = {
      id: "call_01a1b2c3d4",
      title:
        'await tools["studio-ui"].render_editorial_diagram({ title: "Redis 缓存读写链路", description: "inkdown 服务端缓存标准链路: 命中直返，未命中回源回写", diagramType: "flowchart", accent: "indigo", data: { steps: [{ id: "req", label: "请求接入" }, { id: "redis", label: "查 Redis" }, { id: "hit", label: "命中直返" }, { id: "db", label: "未命中查 DB" }, { id: "write", label: "回写并设过期" }, { id: "ret", label: "返回" }] } })',
      status: "completed" as const,
    };

    expect(isGenerativeTool(userScreenshotTool)).toBe(true);

    const args = extractToolArgs(userScreenshotTool);
    expect(args.title).toBe("Redis 缓存读写链路");
    expect(args.diagramType).toBe("flowchart");
    expect(args.accent).toBe("indigo");
    expect(args.data?.steps).toHaveLength(6);

    await act(async () => {
      root.render(<AcpGenerativeToolCard tool={userScreenshotTool} />);
    });

    expect(container.textContent).toContain("Redis 缓存读写链路");
    expect(container.textContent).toContain("流程与状态机");
    expect(container.textContent).toContain("请求接入");
    expect(container.textContent).toContain("查 Redis");
    expect(container.textContent).toContain("命中直返");
    expect(container.textContent).toContain("未命中查 DB");
    expect(container.textContent).toContain("回写并设过期");
    expect(container.textContent).toContain("返回");

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("OpenCode Live 7: real OpenCode execute sandbox call with title=execute, code in rawInput and MCP metadata in rawOutput", async () => {
    // 真实生产线上抓取的 OpenCode 工具执行 payload
    const realExecuteTool = {
      id: "call_01a13f6c46bd76bdaee11a172b68b27a",
      title: "execute",
      kind: "other",
      status: "completed" as const,
      locations: [],
      rawInput: {
        code: 'await tools["studio-ui"].render_editorial_diagram({\n  title: "Redis 缓存读写穿透流程",\n  description: "inkdown 服务端缓存标准链路：命中直返，未命中回源回写",\n  diagramType: "flowchart",\n  theme: "system",\n  accent: "indigo",\n  data: {\n    steps: [\n      {id: "req", label: "请求接入", status: "completed"},\n      {id: "check", label: "查 Redis 缓存", status: "completed"},\n      {id: "hit", label: "命中直返", status: "active"}\n    ],\n    connections: [\n      {from: "req", to: "check"},\n      {from: "check", to: "hit"}\n    ]\n  }\n});\nreturn "rendered";',
      },
      rawOutput: {
        metadata: {
          toolCalls: [
            {
              tool: "studio-ui.render_editorial_diagram",
              status: "completed",
              input: {
                title: "Redis 缓存读写穿透流程",
                description: "inkdown 服务端缓存标准链路：命中直返，未命中回源回写",
                diagramType: "flowchart",
                theme: "system",
                accent: "indigo",
                data: {
                  steps: [
                    { id: "req", label: "请求接入", status: "completed" },
                    { id: "check", label: "查 Redis 缓存", status: "completed" },
                    { id: "hit", label: "命中直返", status: "active" },
                  ],
                  connections: [
                    { from: "req", to: "check" },
                    { from: "check", to: "hit" },
                  ],
                },
              },
            },
          ],
          truncated: false,
        },
      },
    };

    expect(isGenerativeTool(realExecuteTool)).toBe(true);

    const args = extractToolArgs(realExecuteTool);
    expect(args.title).toBe("Redis 缓存读写穿透流程");
    expect(args.diagramType).toBe("flowchart");
    expect(args.accent).toBe("indigo");
    expect(args.data?.steps).toHaveLength(3);

    await act(async () => {
      root.render(<AcpGenerativeToolCard tool={realExecuteTool} />);
    });

    expect(container.textContent).toContain("Redis 缓存读写穿透流程");
    expect(container.textContent).toContain("流程与状态机");
    expect(container.textContent).toContain("请求接入");
    expect(container.textContent).toContain("查 Redis 缓存");
    expect(container.textContent).toContain("命中直返");

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("OpenCode Live 8: execute code that merely mentions a tool name in comments stays a regular tool", async () => {
    // 误伤回归：注释里顺带一提 prompt_form，但没有 studio-ui 调用上下文，不得成卡。
    const commentOnlyTool = {
      id: "call_comment",
      title: "execute",
      status: "completed" as const,
      rawInput: {
        code: '// TODO: use prompt_form for onboarding\nconst r = await search({query: "users", limit: 5});\nreturn r;',
      },
      rawOutput: {
        metadata: { toolCalls: [{ status: "completed", tool: "search" }], truncated: false },
      },
    };

    expect(isGenerativeTool(commentOnlyTool)).toBe(false);

    const regular = [commentOnlyTool].filter((tc) => !isGenerativeTool(tc));
    expect(regular).toHaveLength(1);
  });
});
