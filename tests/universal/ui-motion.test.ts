import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { Skeleton } from "../../src/components/ui/skeleton";
import { BlurFade } from "../../src/components/magicui/blur-fade";
import { AnimatedShinyText } from "../../src/components/magicui/animated-shiny-text";
import { Markdown } from "../../src/components/universal/Markdown";

describe("motion primitives (shadcn + magic ui)", () => {
  it("Skeleton renders a pulsing block", () => {
    const html = renderToString(h(Skeleton, { className: "h-4 w-full" }));
    expect(html).toContain("animate-pulse");
    expect(html).toContain("h-4");
  });

  it("AnimatedShinyText renders children with the shine sweep", () => {
    const html = renderToString(h(AnimatedShinyText, null, "正在思考…"));
    expect(html).toContain("正在思考…");
    expect(html).toContain("animate-shiny-text");
  });

  it("BlurFade renders children for entrance animation", () => {
    const html = renderToString(h(BlurFade, { delay: 0.1 }, h("span", null, "hello")));
    expect(html).toContain("hello");
  });

  it("Markdown renders rich text without literal palette classes", () => {
    const html = renderToString(
      h(Markdown, { text: "# Title\n\n- item one\n- item two\n\n**bold** and `code`\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n" })
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<ul");
    expect(html).toContain("<strong");
    expect(html).toContain("<table");
    expect(html).toContain("const a = 1;");
    for (const banned of ["slate-", "indigo-", "purple-", "pink-", "emerald-", "amber-", "rose-", "sky-"]) {
      expect(html).not.toContain(banned);
    }
  });
});
