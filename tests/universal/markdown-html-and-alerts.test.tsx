import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { AcpBlockquote } from "@/components/assistant/AcpMarkdown";

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
});

