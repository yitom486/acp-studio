/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AcpGenerativeToolCard, extractToolArgs, inferDiagramType, isGenerativeTool, resolveGenerativeToolName } from "../../src/components/assistant/toolkit";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// agy 1.3.5 stream-json parameters use a generic MCP router, unlike OpenCode inputs.
const payload = { title: "Flowchart diagnostic", diagramType: "flowchart", data: {
  steps: [{ id: "start", label: "Start" }, { id: "end", label: "End" }], connections: [{ from: "start", to: "end" }],
} };
const tool = {
  id: "agy-t1-s2", name: "call_mcp_tool", title: "Call Mcp Tool", status: "completed",
  rawInput: { Arguments: payload, ServerName: "studio-ui", ToolName: "render_editorial_diagram" },
  rawOutput: '[Present: diagram-flowchart] 矢量图表数据已生成，等待客户端渲染呈现。',
};

function renderTool(input: unknown, check: (element: HTMLDivElement) => void) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  try {
    act(() => root.render(<AcpGenerativeToolCard tool={input} />));
    check(element);
  } finally { act(() => root.unmount()); element.remove(); }
}

describe("agy MCP generative UI compatibility", () => {
  it("unwraps the actual tool name and Arguments instead of rendering a default architecture", () => {
    expect(isGenerativeTool(tool)).toBe(true);
    expect(resolveGenerativeToolName(tool)).toBe("render_editorial_diagram");
    expect(extractToolArgs(tool)).toEqual(payload);
    expect(inferDiagramType(extractToolArgs(tool))).toBe("flowchart");
    renderTool(tool, element => {
      expect(element.textContent).toContain("Flowchart diagnostic");
      expect(element.textContent).toContain("流程与状态机");
      expect(element.textContent).toContain("Start");
      expect(element.textContent).toContain("End");
      expect(element.textContent).not.toContain("系统架构分层");
      expect(element.querySelector("svg")).not.toBeNull();
    });
  });

  it("accepts JSON-encoded routing objects and argument objects", () => {
    const input = { ...tool, rawInput: JSON.stringify({ ...tool.rawInput, Arguments: JSON.stringify(payload) }) };
    expect(resolveGenerativeToolName(input)).toBe("render_editorial_diagram");
    expect(extractToolArgs(input)).toEqual(payload);
  });

  it("does not turn unrelated MCP calls into diagram cards", () => {
    expect(isGenerativeTool({ ...tool, rawInput: { ServerName: "other", ToolName: "list_files", Arguments: {} }, rawOutput: "OK" })).toBe(false);
  });

  it("shows an explicit error for settled missing diagram data instead of a blank canvas", () => {
    renderTool({ ...tool, rawInput: { ...tool.rawInput, Arguments: { title: "Missing", diagramType: "flowchart", data: {} } } }, element => {
      expect(element.textContent).toContain("图表数据缺失");
      expect(element.querySelector("svg")).toBeNull();
    });
  });

  it("does not render a success card for failed or still-pending calls", () => {
    renderTool({ ...tool, status: "failed" }, element => {
      expect(element.textContent).toContain("工具调用未成功");
      expect(element.querySelector("svg")).toBeNull();
    });
    renderTool({ ...tool, status: "in_progress", rawInput: { ...tool.rawInput, Arguments: {} } }, element => {
      expect(element.textContent).toContain("正在生成");
      expect(element.querySelector("svg:not(.lucide)")).toBeNull();
    });
  });
});
