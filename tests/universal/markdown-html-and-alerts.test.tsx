import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { AcpBlockquote, AcpStandaloneMarkdown } from "@/components/assistant/AcpMarkdown";
import { preprocessMarkdown } from "@/lib/markdown-preprocess";
import { normalizeFPS, getAdaptiveSmoothOptions } from "@/lib/fps-adaptive";

describe("Markdown HTML and GitHub Alert Callouts", () => {
  it("renders GitHub [!NOTE] alert callout with proper badge and icon", () => {
    const markdown = "> [!NOTE]\n> AutumnFlow provides unified ACP agent workflows.";
    const html = renderToString(
      React.createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeRaw],
        components: {
          blockquote: AcpBlockquote,
        },
        children: markdown,
      })
    );
    expect(html).toContain('data-alert="note"');
    expect(html).toContain("Note");
    expect(html).toContain("AutumnFlow provides unified ACP agent workflows.");
  });

  it("renders GitHub [!TIP] alert callout correctly", () => {
    const markdown = "> [!TIP]\n> Use keyboard shortcuts for faster navigation.";
    const html = renderToString(
      React.createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeRaw],
        components: {
          blockquote: AcpBlockquote,
        },
        children: markdown,
      })
    );
    expect(html).toContain('data-alert="tip"');
    expect(html).toContain("Tip");
    expect(html).toContain("Use keyboard shortcuts for faster navigation.");
  });

  it("renders GitHub [!WARNING] alert callout correctly", () => {
    const markdown = "> [!WARNING]\n> File writes outside workspace will be guarded.";
    const html = renderToString(
      React.createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeRaw],
        components: {
          blockquote: AcpBlockquote,
        },
        children: markdown,
      })
    );
    expect(html).toContain('data-alert="warning"');
    expect(html).toContain("Warning");
    expect(html).toContain("File writes outside workspace will be guarded.");
  });

  it("renders regular blockquote without alert styling", () => {
    const markdown = "> 秋水时至，百川灌河。";
    const html = renderToString(
      React.createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeRaw],
        components: {
          blockquote: AcpBlockquote,
        },
        children: markdown,
      })
    );
    expect(html).not.toContain("data-alert=");
    expect(html).toContain("<blockquote");
    expect(html).toContain("秋水时至，百川灌河。");
  });

  it("renders raw HTML <kbd> tags with keycap badge styling", () => {
    const markdown = "Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> to open command palette.";
    const html = renderToString(
      React.createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeRaw],
        children: markdown,
      })
    );
    expect(html).toContain("<kbd>Ctrl</kbd>");
    expect(html).toContain("<kbd>Shift</kbd>");
    expect(html).toContain("<kbd>P</kbd>");
  });

  it("renders raw HTML <details> and <summary> disclosure tags", () => {
    const markdown = "<details><summary>点击展开详情</summary><p>这里是折叠的内容</p></details>";
    const html = renderToString(
      React.createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeRaw],
        children: markdown,
      })
    );
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("点击展开详情");
    expect(html).toContain("这里是折叠的内容");
  });

  it("renders <mark> highlight tags", () => {
    const markdown = "Here is <mark>important text</mark> highlighted.";
    const html = renderToString(
      React.createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeRaw],
        children: markdown,
      })
    );
    expect(html).toContain("<mark>important text</mark>");
  });

  it("renders rich progress markdown through AcpStandaloneMarkdown", () => {
    const markdown = "### 排查进展\n\n已完成 **96 项核心测试**。\n\n> [!NOTE]\n> 渲染引擎已自动就绪。\n\n```ts\nconst ready = true;\n```";
    const html = renderToString(React.createElement(AcpStandaloneMarkdown, { content: markdown }));
    expect(html).toContain("排查进展</h3>");
    expect(html).toContain('class="font-semibold">96 项核心测试</strong>');
    expect(html).toContain('data-alert="note"');
    expect(html).toContain("渲染引擎已自动就绪。");
    expect(html).toContain("const ready = true;");
  });

  it("normalizes loose bold delimiters with trailing/leading spaces (anti-fingerprinting case)", () => {
    const raw = "出于**防止用户硬件指纹追踪 (Anti-Fingerprinting) **的隐私机制";
    const normalized = preprocessMarkdown(raw);
    expect(normalized).toBe("出于**防止用户硬件指纹追踪 (Anti-Fingerprinting)** 的隐私机制");

    const html = renderToString(React.createElement(AcpStandaloneMarkdown, { content: raw }));
    expect(html).toContain('class="font-semibold">防止用户硬件指纹追踪 (Anti-Fingerprinting)</strong>');
  });

  it("preserves code blocks without corrupting asterisks inside them", () => {
    const raw = "Prose **bold text ** outside\n```js\nconst x = **not bold **;\n```";
    const normalized = preprocessMarkdown(raw);
    expect(normalized).toContain("**bold text**");
    expect(normalized).toContain("const x = **not bold **;");
  });

  it("adapts smooth typewriter streaming parameters to screen refresh rate (60Hz vs 180Hz vs 240Hz)", () => {
    expect(normalizeFPS(59.9)).toBe(60);
    expect(normalizeFPS(179.2)).toBe(180);
    expect(normalizeFPS(240.1)).toBe(240);

    const smooth60 = getAdaptiveSmoothOptions(60);
    const smooth180 = getAdaptiveSmoothOptions(180);
    const smooth240 = getAdaptiveSmoothOptions(240);

    // 180Hz screen frame duration is ~5.55ms; maxCharIntervalMs must be <= 1.5ms to avoid skipping every other frame
    expect(smooth180.maxCharIntervalMs).toBeLessThanOrEqual(1.5);
    expect(smooth240.maxCharIntervalMs).toBeLessThanOrEqual(1.0);
    expect(smooth60.maxCharIntervalMs).toBeGreaterThan(smooth180.maxCharIntervalMs);
  });
});

