import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorialDiagramCard, type DiagramType } from "../../src/components/assistant/EditorialDiagramCard";
import { editorialCases } from "../fixtures/diagram-cases";

function render(kind: DiagramType, data: Record<string, unknown>) {
  const markup = renderToStaticMarkup(createElement(EditorialDiagramCard, { title: "测试图表", diagramType: kind, data }));
  const container = document.createElement("div");
  container.innerHTML = markup;
  const svg = container.querySelector<SVGSVGElement>('svg[viewBox^="0 0 640 "]')!;
  expect(svg).not.toBeNull();
  expect(svg.outerHTML).not.toMatch(/NaN|Infinity|undefined/);
  return svg;
}

describe("Structured diagram payload contracts", () => {
  for (const scenario of editorialCases) {
    it(`${scenario.kind} preserves the agent's labels and valid SVG geometry`, () => {
      const svg = render(scenario.kind, scenario.data);
      for (const label of scenario.labels) expect(svg.textContent).toContain(label);
      expect(svg.getAttribute("viewBox")).toMatch(/^0 0 640 \d+$/);
    });
    it(`${scenario.kind} handles empty collections without invalid SVG coordinates`, () => {
      render(scenario.kind, {});
    });
  }

  it("flowchart supports nodes/edges aliases and drops unresolved connections", () => {
    const svg = render("flowchart", {
      nodes: [{ id: "a", name: "开始" }, { id: "b", name: "完成" }],
      edges: [{ source: "a", target: "b" }, { source: "missing", target: "b" }],
    });
    expect(svg.textContent).toContain("开始");
    expect(svg.textContent).toContain("完成");
    expect(svg.querySelectorAll("line[marker-end]")).toHaveLength(1);
  });

  it("sequence supports explicit participants, self calls and dashed replies", () => {
    const svg = render("sequence", {
      participants: [{ id: "client", label: "客户端" }, { id: "server", label: "服务端" }],
      messages: [{ from: "client", to: "server", label: "请求" },
        { from: "server", to: "server", label: "内部处理" },
        { from: "server", to: "client", label: "响应", type: "reply" }],
    });
    expect(svg.querySelectorAll("[marker-end]")).toHaveLength(3);
    expect(svg.querySelector("path[marker-end]")).not.toBeNull();
    expect(svg.querySelector('line[marker-end][stroke-dasharray="3 3"]')).not.toBeNull();
  });

  it("fullscreen escapes transformed chat containers and restores scrolling on Escape", async () => {
    const host = document.createElement("div");
    host.style.transform = "translateZ(0)";
    host.style.contain = "paint";
    document.body.appendChild(host);
    const root = createRoot(host);
    const overflow = document.body.style.overflow;
    try {
      await act(async () => root.render(createElement(EditorialDiagramCard, {
        title: "全屏回归", diagramType: "flowchart", data: editorialCases[2].data,
      })));
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="全屏放大"]')!.click());
      const dialog = document.querySelector('[role="dialog"][aria-label="全屏回归 全屏预览"]')!;
      expect(dialog.parentElement).toBe(document.body);
      expect(document.body.style.overflow).toBe("hidden");
      expect(document.activeElement?.getAttribute("aria-label")).toBe("退出全屏");
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })));
      expect(document.querySelector('[aria-label="全屏回归 全屏预览"]')).toBeNull();
      expect(host.querySelector('[aria-label="全屏放大"]')).not.toBeNull();
      expect(document.body.style.overflow).toBe(overflow);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      document.body.style.overflow = overflow;
    }
  });
});
