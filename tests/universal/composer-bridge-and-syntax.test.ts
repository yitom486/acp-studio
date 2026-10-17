import { describe, expect, it, vi } from "vitest";
import {
  formatSnippetPrompt,
  sendSnippetToComposer,
  sendDropToComposer,
  ACP_INSERT_SNIPPET_EVENT,
  ACP_COMPOSER_DROP_EVENT,
} from "../../src/lib/composer-bridge";
import { acpHighlight } from "../../src/components/workbench/codemirror-setup";

describe("composer bridge: formatSnippetPrompt", () => {
  it("formats multi-line code snippet with line range and language", () => {
    const formatted = formatSnippetPrompt({
      path: "src/main.ts",
      fromLine: 19,
      toLine: 25,
      code: "function sendNotification() {\n  return 1;\n}",
      lang: "typescript",
    });

    expect(formatted).toBe(
      "@src/main.ts#L19-L25\n```typescript\nfunction sendNotification() {\n  return 1;\n}\n```"
    );
  });

  it("formats single-line code snippet with single line number", () => {
    const formatted = formatSnippetPrompt({
      path: "src/config.json",
      fromLine: 42,
      toLine: 42,
      code: '"version": "1.0.0"',
      lang: "json",
    });

    expect(formatted).toBe(
      '@src/config.json#L42\n```json\n"version": "1.0.0"\n```'
    );
  });

  it("formats whole file or snippet without line numbers", () => {
    const formatted = formatSnippetPrompt({
      path: "README.md",
      code: "# Hello World",
      lang: "markdown",
    });

    expect(formatted).toBe("@README.md\n```markdown\n# Hello World\n```");
  });

  it("dispatches ACP_INSERT_SNIPPET_EVENT through window", () => {
    const listener = vi.fn();
    window.addEventListener(ACP_INSERT_SNIPPET_EVENT, listener);

    sendSnippetToComposer({
      path: "src/index.ts",
      fromLine: 1,
      toLine: 5,
      code: "const a = 1;",
      lang: "typescript",
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({
      path: "src/index.ts",
      fromLine: 1,
      toLine: 5,
      code: "const a = 1;",
      lang: "typescript",
    });

    window.removeEventListener(ACP_INSERT_SNIPPET_EVENT, listener);
  });

  it("dispatches ACP_COMPOSER_DROP_EVENT through window", () => {
    const listener = vi.fn();
    window.addEventListener(ACP_COMPOSER_DROP_EVENT, listener);

    sendDropToComposer({
      internalRefs: [{ path: "src/lib", kind: "dir" }],
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({
      internalRefs: [{ path: "src/lib", kind: "dir" }],
    });

    window.removeEventListener(ACP_COMPOSER_DROP_EVENT, listener);
  });
});

describe("codemirror syntax highlight style", () => {
  it("defines acpHighlight with semantic syntax variables", () => {
    expect(acpHighlight).toBeDefined();
    // acpHighlight should have rules defined
    expect((acpHighlight as any).style).toBeDefined();
  });
});

