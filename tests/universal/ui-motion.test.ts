import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { Skeleton } from "../../src/components/ui/skeleton";
import { BlurFade } from "../../src/components/magicui/blur-fade";
import { AnimatedShinyText } from "../../src/components/magicui/animated-shiny-text";
import { Markdown } from "../../src/components/universal/Markdown";
import { CodeComparison } from "../../src/components/magicui/code-comparison";
import { parseUnifiedDiff, guessLanguage } from "../../src/lib/universal-api";
import { reportError, subscribeErrors, dismissError, clearErrors } from "../../src/lib/error-bus";
import { ErrorBoundary } from "../../src/components/ErrorBoundary";

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

  it("error bus collects, notifies and dismisses", () => {
    clearErrors();
    const seen: string[][] = [];
    const unsub = subscribeErrors((list) => seen.push(list.map((e) => e.message)));
    const entry = reportError("test-source", new Error("boom"));
    expect(entry.source).toBe("test-source");
    expect(seen.at(-1)).toContain("boom");
    dismissError(entry.id);
    expect(seen.at(-1)).toEqual([]);
    unsub();
    clearErrors();
  });

  it("ErrorBoundary renders children when healthy", () => {
    const html = renderToString(h(ErrorBoundary, null, h("span", null, "healthy")));
    expect(html).toContain("healthy");
  });

  it("shadcn channel is properly introduced (components.json matches repo layout)", () => {
    const root = process.cwd();
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "components.json"), "utf8"));
    expect(cfg.tsx).toBe(true);
    expect(cfg.aliases["ui"]).toBe("@/components/ui");
    expect(cfg.aliases["utils"]).toBe("@/lib/utils");
    // configured paths must actually exist
    expect(fs.existsSync(path.join(root, cfg.tailwind.css))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/components/ui"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/components/magicui"))).toBe(true);
  });

  it("CodeComparison renders filename plus both panes (fallback path)", () => {
    const html = renderToString(
      h(CodeComparison, { beforeCode: "const a = 1;", afterCode: "const a = 2;", language: "typescript", filename: "a.ts" })
    );
    expect(html).toContain("a.ts");
    expect(html).toContain("before");
    expect(html).toContain("after");
    expect(html).toContain("const a = 1;");
  });

  it("parseUnifiedDiff classifies hunks, adds, dels and context", () => {
    const lines = parseUnifiedDiff("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n-old\n+new\n ctx\n");
    expect(lines).toEqual([
      { kind: "hunk", text: "@@ -1,2 +1,2 @@" },
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
      { kind: "ctx", text: "ctx" },
    ]);
    expect(parseUnifiedDiff(null)).toEqual([]);
    expect(guessLanguage("app.tsx")).toBe("tsx");
    expect(guessLanguage("nope.unknownext")).toBe("text");
  });
});
