import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DecisionCard,
  ChecklistCard,
  MetricsCard,
  PromptFormCard,
} from "../../src/components/assistant/GenerativeCards";
import { ReactArtifactCard } from "../../src/components/assistant/ReactArtifactCard";
import { AcpCodeHeader } from "../../src/components/assistant/AcpMarkdown";
import { EditorialDiagramCard } from "../../src/components/assistant/EditorialDiagramCard";

// Helper to reliably trigger React 19 synthetic onChange events on uncontrolled/controlled inputs in happy-dom
function setInputValue(input: HTMLInputElement, value: string | boolean) {
  const isCheckbox = input.type === "checkbox";
  const prop = isCheckbox ? "checked" : "value";
  const proto = window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event(isCheckbox ? "click" : "input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Generative UI - Front-End Component End-to-End Tests", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalConsoleError = console.error;

  beforeEach(() => {
    // Suppress happy-dom's benign script loading error inside iframe srcDoc
    console.error = (...args: any[]) => {
      const msg = typeof args[0] === "string" ? args[0] : "";
      if (msg.includes("JavaScript file loading is disabled") || msg.includes("Failed to load script")) {
        return;
      }
      originalConsoleError(...args);
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    console.error = originalConsoleError;
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("E2E: DecisionCard renders options, recommended badge, and handles user option clicks", async () => {
    const onSelect = vi.fn();
    const options = [
      {
        id: "canary",
        label: "灰度金丝雀发布 (Canary)",
        recommended: true,
        description: "先向 5% 灰度用户放量",
      },
      {
        id: "bluegreen",
        label: "蓝绿双集群热切 (Blue-Green)",
        description: "独立备用集群全量验证后瞬间切流",
      },
    ];

    await act(async () => {
      root.render(
        <DecisionCard
          title="发布架构策略决策"
          description="挑选最佳生产切流策略"
          options={options}
          onSelect={onSelect}
        />
      );
    });

    // 1. Assert Title, Description, and Badges
    expect(container.textContent).toContain("发布架构策略决策");
    expect(container.textContent).toContain("挑选最佳生产切流策略");
    expect(container.textContent).toContain("灰度金丝雀发布 (Canary)");
    expect(container.textContent).toContain("推荐");
    expect(container.textContent).toContain("蓝绿双集群热切 (Blue-Green)");

    // 2. Click the second option (Blue-Green)
    const optionCards = container.querySelectorAll(".group.relative");
    expect(optionCards.length).toBe(2);

    await act(async () => {
      optionCards[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 3. Verify interaction callback & UI active selection state
    expect(onSelect).toHaveBeenCalledWith("bluegreen");
    expect(optionCards[1].className).toContain("border-primary");
  });

  it("E2E: ChecklistCard displays progress bar and updates dynamically on user toggle", async () => {
    const items = [
      { id: "item1", label: "单元测试覆盖率门禁", checked: true },
      { id: "item2", label: "核心业务路径端到端测试", checked: false },
      { id: "item3", label: "静态代码与安全漏洞扫描", checked: true },
    ];

    await act(async () => {
      root.render(
        <ChecklistCard
          title="发布前门禁校验"
          description="必须全部通过后方可开放生产公网流量"
          items={items}
        />
      );
    });

    // Initial state: 2 out of 3 done (67%)
    expect(container.textContent).toContain("发布前门禁校验");
    expect(container.textContent).toContain("2 / 3 (67%)");

    const progressBar = container.querySelector(".bg-primary.h-full") as HTMLElement;
    expect(progressBar).not.toBeNull();
    expect(progressBar.style.width).toBe("67%");

    // Click on the second item to toggle it to checked
    const itemRows = container.querySelectorAll(".space-y-1\\.5 > div");
    expect(itemRows.length).toBe(3);

    await act(async () => {
      itemRows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // State after click: 3 out of 3 done (100%)
    expect(container.textContent).toContain("3 / 3 (100%)");
    expect(progressBar.style.width).toBe("100%");
    expect(itemRows[1].className).toContain("line-through");
  });

  it("E2E: MetricsCard renders stats grid, trends, and progress bars accurately", async () => {
    const metrics = [
      { label: "平均延迟 (P95)", value: "8.4", unit: "ms", change: "-12%" },
      { label: "吞吐量峰值", value: "10,240", unit: "req/s", change: "+15%" },
      { label: "CPU 负载", value: "48", unit: "%", progress: 48 },
    ];

    await act(async () => {
      root.render(
        <MetricsCard
          title="压测性能指标看板"
          description="峰值模拟 10,000 QPS 压测表现"
          metrics={metrics}
        />
      );
    });

    expect(container.textContent).toContain("压测性能指标看板");
    expect(container.textContent).toContain("8.4");
    expect(container.textContent).toContain("ms");
    expect(container.textContent).toContain("-12%");

    expect(container.textContent).toContain("10,240");
    expect(container.textContent).toContain("req/s");
    expect(container.textContent).toContain("+15%");

    expect(container.textContent).toContain("48");
    expect(container.textContent).toContain("%");

    const cpuProgress = container.querySelector(".bg-primary.h-full") as HTMLElement;
    expect(cpuProgress).not.toBeNull();
    expect(cpuProgress.style.width).toBe("48%");
  });

  it("E2E: PromptFormCard handles user input updates, validation, and submission", async () => {
    const onSubmit = vi.fn();
    const fields = [
      { id: "db_host", label: "数据库主机", defaultValue: "10.0.0.8", required: true },
      { id: "db_port", label: "连接端口", type: "number", defaultValue: 5432 },
      { id: "db_ssl", label: "启用 SSL 加密", type: "checkbox", defaultValue: true },
    ];

    await act(async () => {
      root.render(
        <PromptFormCard
          title="数据库配置向导"
          description="请录入目标环境数据库连接凭证"
          submitLabel="验证连接并保存"
          fields={fields}
          onSubmit={onSubmit}
        />
      );
    });

    expect(container.textContent).toContain("数据库配置向导");
    expect(container.textContent).toContain("请录入目标环境数据库连接凭证");

    // 1. Find form inputs
    const textInput = container.querySelector("input[type='text']") as HTMLInputElement;
    const numInput = container.querySelector("input[type='number']") as HTMLInputElement;
    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;

    expect(textInput.value).toBe("10.0.0.8");
    expect(numInput.value).toBe("5432");
    expect(checkbox.checked).toBe(true);

    // 2. Simulate user edits using setInputValue helper
    await act(async () => {
      setInputValue(textInput, "192.168.1.100");
      setInputValue(numInput, "5433");
      setInputValue(checkbox, false);
    });

    // 3. Submit form
    const submitBtn = container.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(submitBtn.textContent).toContain("验证连接并保存");

    await act(async () => {
      submitBtn.click();
    });

    // 4. Assert submission callback received edited state
    expect(onSubmit).toHaveBeenCalledWith({
      db_host: "192.168.1.100",
      db_port: "5433",
      db_ssl: false,
    });

    // 5. Assert UI shows submitted badge
    expect(container.textContent).toContain("已提交");
  });

  it("E2E: ReactArtifactCard renders iframe with strict sandbox, and allows Tab switching & reload", async () => {
    const sampleCode = `function App() {
  const [count, setCount] = React.useState(0);
  return <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>;
}`;

    await act(async () => {
      root.render(
        <ReactArtifactCard
          title="动态计数器原型"
          template="react"
          code={sampleCode}
        />
      );
    });

    // 1. Verify Title & Header Tabs
    expect(container.textContent).toContain("动态计数器原型");
    expect(container.textContent).toContain("预览");
    expect(container.textContent).toContain("代码");

    // 2. Verify Iframe Security Boundary
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    const sandboxAttr = iframe.getAttribute("sandbox") || "";
    expect(sandboxAttr).toContain("allow-scripts");
    expect(sandboxAttr).not.toContain("allow-same-origin"); // STRICT ISOLATION REQUIREMENT

    // 3. Verify Sandboxed Document includes Babel + React + Code
    const srcDoc = iframe.srcdoc;
    expect(srcDoc).toContain("cdn.tailwindcss.com");
    expect(srcDoc).toContain("@babel/standalone");
    expect(srcDoc).toContain("react@18");
    expect(srcDoc).toContain("react-dom@18");
    expect(srcDoc).toContain("function App()");
    expect(srcDoc).toContain("React.useState(0)");

    // 4. Switch to Code Tab
    const codeTabBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "代码"
    );
    expect(codeTabBtn).toBeDefined();

    await act(async () => {
      codeTabBtn!.click();
    });

    // In code tab, the code snippet should be displayed
    expect(container.textContent).toContain("function App()");
    expect(container.textContent).toContain("React.useState(0)");

    // 5. Switch back to Preview Tab
    const previewTabBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "预览"
    );
    expect(previewTabBtn).toBeDefined();

    await act(async () => {
      previewTabBtn!.click();
    });

    // In preview tab, iframe should be active
    const restoredIframe = container.querySelector("iframe");
    expect(restoredIframe).not.toBeNull();

    // 6. Test Reload button
    const reloadBtn = container.querySelector("button[title='重新加载组件']") as HTMLButtonElement;
    expect(reloadBtn).not.toBeNull();
    await act(async () => {
      reloadBtn.click();
    });
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("E2E: AcpCodeHeader renders inline '运行预览' button and mounts live ReactArtifactCard", async () => {
    const sampleCode = `function InteractiveCounter() {
  const [val, setVal] = React.useState(10);
  return (
    <div className="p-4 bg-slate-900 text-white rounded">
      <h3>当前数值: {val}</h3>
      <button onClick={() => setVal(v => v + 1)}>+1</button>
    </div>
  );
}`;

    await act(async () => {
      root.render(<AcpCodeHeader language="tsx" code={sampleCode} />);
    });

    // 1. Verify language badge and "运行预览" button
    expect(container.textContent).toContain("tsx");
    const previewToggleBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().includes("运行预览")
    );
    expect(previewToggleBtn).toBeDefined();

    // 2. Click "运行预览" to switch from static view to live interactive sandbox
    await act(async () => {
      previewToggleBtn!.click();
    });

    // Wait for Suspense lazy component to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Assert that live ReactArtifactCard iframe is now mounted in the DOM
    const liveIframe = container.querySelector("iframe");
    expect(liveIframe).not.toBeNull();
    expect(liveIframe!.srcdoc).toContain("InteractiveCounter");

    // 3. Click "查看源码" to toggle back to code view
    const viewCodeBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().includes("查看源码")
    );
    expect(viewCodeBtn).toBeDefined();

    await act(async () => {
      viewCodeBtn!.click();
    });

    // Verify switched back to initial header state
    const previewBtnAgain = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().includes("运行预览")
    );
    expect(previewBtnAgain).toBeDefined();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("E2E: EditorialDiagramCard renders interactive controls, SVG elements, and responds to zoom and copy", async () => {
    // Mock clipboard writeText
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    try {
      vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeTextMock);
    } catch {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        configurable: true,
      });
    }

    await act(async () => {
      root.render(
        React.createElement(EditorialDiagramCard, {
          title: "分布式事务架构",
          diagramType: "architecture",
          description: "基于两阶段提交与 Saga 的容灾架构",
          accent: "emerald",
          data: {
            layers: [
              {
                id: "client-layer",
                title: "客户端层",
                nodes: [{ id: "spa", label: "React Client", subtext: "v18", highlighted: true }],
              },
              {
                id: "gateway-layer",
                title: "API 网关层",
                nodes: [{ id: "gw", label: "Envoy Gateway", subtext: ":8080" }],
              },
            ],
            connections: [{ from: "client-layer", to: "gateway-layer", label: "HTTPS" }],
          },
        })
      );
    });

    // 1. Verify Header and Labels
    expect(container.textContent).toContain("分布式事务架构");
    expect(container.textContent).toContain("基于两阶段提交与 Saga 的容灾架构");
    expect(container.textContent).toContain("系统架构分层");
    expect(container.textContent).toContain("editorial");

    // 2. Verify SVG rendered
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(container.textContent).toContain("React Client");
    expect(container.textContent).toContain("Envoy Gateway");

    // 3. Test Zoom buttons
    const zoomInBtn = container.querySelector('button[title="放大"]') as HTMLButtonElement;
    expect(zoomInBtn).not.toBeNull();

    await act(async () => {
      zoomInBtn.click();
    });

    const resetZoomBtn = container.querySelector('button[title="重置缩放"]') as HTMLButtonElement;
    expect(resetZoomBtn).not.toBeNull();

    await act(async () => {
      resetZoomBtn.click();
    });

    // 4. Test Copy SVG
    const copySvgBtn = container.querySelector('button[title="复制 SVG 源码"]') as HTMLButtonElement;
    expect(copySvgBtn).not.toBeNull();

    await act(async () => {
      copySvgBtn.click();
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0][0]).toContain("<svg");
  });
});
