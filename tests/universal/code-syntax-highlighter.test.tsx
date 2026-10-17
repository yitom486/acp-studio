import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { AcpSyntaxHighlighter } from "@/components/assistant/AcpMarkdown";
import { getHighlighter, ensureLanguage } from "@/components/magicui/code-comparison";

describe("AcpSyntaxHighlighter", () => {
  it("renders a clean fallback pre code block during initial/SSR mount", () => {
    const code = "const meaning = 42;";
    const html = renderToString(React.createElement(AcpSyntaxHighlighter, { language: "typescript", code }));
    expect(html).toContain("<pre");
    expect(html).toContain("const meaning = 42;");
  });

  it("shiki highlights typescript code tokens correctly with active theme", async () => {
    const code = 'import { createPool } from "generic-pool";';
    const hl = await getHighlighter();
    const lang = await ensureLanguage(hl, "typescript");
    expect(lang).toBe("typescript");

    const htmlDark = hl.codeToHtml(code, { lang: "typescript", theme: "github-dark-default" });
    expect(htmlDark).toContain('class="shiki github-dark-default"');
    // keyword 'import' has shiki token styling
    expect(htmlDark).toContain("import");
    expect(htmlDark).toContain("generic-pool");

    const htmlLight = hl.codeToHtml(code, { lang: "typescript", theme: "github-light-high-contrast" });
    expect(htmlLight).toContain('class="shiki github-light-high-contrast"');
  });
});

