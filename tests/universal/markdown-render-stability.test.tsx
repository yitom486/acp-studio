import { describe, it, expect } from "vitest";
import React, { useState, act } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  areHastNodesSemanticallyEqual,
  memoizeStableMarkdownComponents,
} from "@/components/assistant/AcpMarkdown";
import { preprocessMarkdown } from "@/lib/markdown-preprocess";
import { convertAcpMessage } from "@/lib/acp-assistant";

describe("Stable Markdown Block Memoization & Monotonic Streaming", () => {
  it("never re-renders completed tables or earlier paragraphs when subsequent tokens stream in", async () => {
    let tableRenderCount = 0;
    let p1RenderCount = 0;
    let p2RenderCount = 0;

    const components = memoizeStableMarkdownComponents({
      table: ({ children, ...props }: any) => {
        tableRenderCount++;
        return <table data-testid="table" {...props}>{children}</table>;
      },
      p: ({ children, ...props }: any) => {
        const text = String(children);
        if (text.includes("Paragraph 1")) p1RenderCount++;
        if (text.includes("Paragraph 2")) p2RenderCount++;
        return <p {...props}>{children}</p>;
      },
      tbody: ({ children, ...props }: any) => <tbody {...props}>{children}</tbody>,
      tr: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
      td: ({ children, ...props }: any) => <td {...props}>{children}</td>,
      th: ({ children, ...props }: any) => <th {...props}>{children}</th>,
    });

    let setTextFn: (t: string) => void = () => {};

    function TestApp() {
      const [text, setText] = useState("Paragraph 1\n\n| Col 1 | Col 2 |\n|---|---|\n| A | B |\n\nParagraph 2");
      setTextFn = setText;
      return (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={components}
        >
          {text}
        </ReactMarkdown>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<TestApp />);
    });

    expect(tableRenderCount).toBe(1);
    expect(p1RenderCount).toBe(1);
    expect(p2RenderCount).toBe(1);

    // Stream 10 characters one-by-one into Paragraph 2
    for (let i = 1; i <= 10; i++) {
      await act(async () => {
        setTextFn(`Paragraph 1\n\n| Col 1 | Col 2 |\n|---|---|\n| A | B |\n\nParagraph 2 token ${i}`);
      });
    }

    // Paragraph 1 and Table MUST NOT have re-rendered!
    expect(p1RenderCount).toBe(1);
    expect(tableRenderCount).toBe(1);
    // Only Paragraph 2 was re-rendered with new tokens
    expect(p2RenderCount).toBe(11);

    root.unmount();
    container.remove();
  });

  it("normalizes asymmetric asterisks with Chinese quotes and punctuation without stray asterisks", () => {
    const raw1 = "***“电量杀手”**";
    expect(preprocessMarkdown(raw1).trim()).toBe("**“电量杀手”**");

    const raw2 = "**“电量杀手”***";
    expect(preprocessMarkdown(raw2).trim()).toBe("**“电量杀手”**");

    const raw3 = "出于**防止用户硬件指纹追踪 (Anti-Fingerprinting) **的隐私安全考虑";
    expect(preprocessMarkdown(raw3)).toContain("**防止用户硬件指纹追踪 (Anti-Fingerprinting)** 的隐");
  });

  it("preserves strictly monotonic text stream in convertAcpMessage during active streaming", () => {
    const longContent =
      "正在分析代码结构并执行第一阶段探索任务...\n核对配置文件规范性...\n确认系统环境...\n\n### 总结\n全量改动已就绪，所有模块均已对齐。";
    const streamingMsg: any = {
      id: "streaming-1",
      role: "assistant",
      content: longContent,
      isStreaming: true,
      toolCalls: [{ id: "t1", title: "read_file", status: "completed" }],
    };

    const converted = convertAcpMessage(streamingMsg);
    const textPart = converted.content.find((p) => p.type === "text") as { type: "text"; text: string };
    expect(textPart).toBeDefined();
    // In streaming mode, content MUST NOT be heuristically sliced into conclusion, preventing text collapse/restart!
    expect(textPart.text).toBe(longContent);

    // Once streaming settles (completed turn), partitioning takes place for clean summary layout
    const completedMsg = { ...streamingMsg, isStreaming: false };
    const convertedCompleted = convertAcpMessage(completedMsg);
    const completedTextPart = convertedCompleted.content.find((p) => p.type === "text") as { type: "text"; text: string };
    expect(completedTextPart.text).toBe("### 总结\n全量改动已就绪，所有模块均已对齐。");
  });
});
