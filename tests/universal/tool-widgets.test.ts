import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { buildTranscriptFromReplay } from "@/lib/universal-api";
import {
  FileEditCard,
  FileReadCard,
  SearchCard,
  TerminalCard,
  firstLines,
  isDiffText,
  lastLines,
  resolveWidgetKey,
  toolCommand,
  toolPath,
  toolText,
} from "@/components/assistant/AcpToolWidgets";

describe("tool widget registry (generative UI)", () => {
  it("resolves kinds first, then names, then titles", () => {
    expect(resolveWidgetKey({ title: "x", kind: "execute" })).toBe("terminal");
    expect(resolveWidgetKey({ title: "x", kind: "edit" })).toBe("file-edit");
    expect(resolveWidgetKey({ title: "x", kind: "read" })).toBe("file-read");
    expect(resolveWidgetKey({ title: "x", kind: "search" })).toBe("search");
    expect(resolveWidgetKey({ title: "x", kind: "other" })).toBeNull();
    expect(resolveWidgetKey({ title: "run tests", name: "run_command" })).toBe("terminal");
    expect(resolveWidgetKey({ title: "View", name: "view_file" })).toBe("file-read");
    expect(resolveWidgetKey({ title: "Grep", name: "grep_search" })).toBe("search");
    expect(resolveWidgetKey({ title: "npm run build" })).toBe("terminal");
    expect(resolveWidgetKey({ title: "read notes" })).toBe("file-read");
    expect(resolveWidgetKey({ title: "do something vague" })).toBeNull();
  });

  it("extracts paths and commands defensively", () => {
    expect(toolPath({ title: "read src/App.tsx", locations: [{ path: "a/b.ts" }] })).toBe("a/b.ts");
    expect(toolPath({ title: "open file", rawInput: { file: "c/d.py" } })).toBe("c/d.py");
    expect(toolPath({ title: "read src/App.tsx" })).toBe("src/App.tsx");
    expect(toolPath({ title: "do vague thing" })).toBeNull();
    expect(toolCommand({ title: "fallback", rawInput: { CommandLine: "npm test" } })).toBe("npm test");
    expect(toolCommand({ title: "fallback", rawInput: {} })).toBe("fallback");
  });

  it("stringifies payloads with a cap and detects diffs", () => {
    expect(toolText("abc")).toBe("abc");
    expect(toolText(42)).toBe("42");
    expect(toolText(null)).toBe("");
    expect(toolText("x".repeat(5000), 100)).toContain("truncated");
    expect(firstLines("a\nb\nc", 2).shown).toBe("a\nb");
    expect(lastLines("a\nb\nc", 2).shown).toBe("b\nc");
    expect(isDiffText("@@ -1 +1 @@\n-foo\n+bar")).toBe(true);
    expect(isDiffText("just some log output")).toBe(false);
  });

  it("forwards rich tool payloads through replay without summing", () => {
    const t = buildTranscriptFromReplay([
      { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read f", kind: "read", status: "pending", name: "view_file", rawInput: { path: "f.ts" }, locations: [{ path: "f.ts" }] },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: "const x = 1;\n".repeat(5) },
    ]);
    const tc: any = t.messages[0].toolCalls?.[0];
    expect(tc).toMatchObject({ id: "t1", name: "view_file", status: "completed" });
    expect(tc.rawInput).toMatchObject({ path: "f.ts" });
    expect(tc.locations).toMatchObject([{ path: "f.ts" }]);
    expect(String(tc.rawOutput)).toContain("const x = 1;");
  });
});

async function renderCard(node: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(node);
  });
  return { el, root };
}

describe("tool widget cards", () => {
  it("terminal card shows command tail and error", async () => {
    const { el, root } = await renderCard(
      h(TerminalCard, {
        tc: {
          id: "t1", title: "run tests", kind: "execute", status: "failed",
          startedAt: 1000, completedAt: 2500,
          rawInput: { command: "npm test" },
          rawOutput: "line1\nline2\nline3",
          rawError: "AssertionError: boom",
        },
      } as any)
    );
    expect(el.innerHTML).toContain("npm test");
    expect(el.innerHTML).toContain("line3");
    expect(el.innerHTML).toContain("boom");
    expect(el.innerHTML).toContain("1.5s");
    root.unmount();
    el.remove();
  });

  it("file read card shows path and preview", async () => {
    const { el, root } = await renderCard(
      h(FileReadCard, {
        tc: {
          id: "t2", title: "read src/App.tsx", kind: "read", status: "completed",
          locations: [{ path: "src/App.tsx" }],
          rawOutput: "line1\nline2\n",
        },
      } as any)
    );
    expect(el.innerHTML).toContain("src/App.tsx");
    expect(el.innerHTML).toContain("line1");
    root.unmount();
    el.remove();
  });

  it("file edit card renders diffs with +/- coloring", async () => {
    const { el, root } = await renderCard(
      h(FileEditCard, {
        tc: {
          id: "t3", title: "edit a.ts", kind: "edit", status: "completed",
          rawOutput: "@@ -1 +1 @@\n-old\n+new",
        },
      } as any)
    );
    expect(el.innerHTML).toContain("bg-success/15");
    expect(el.innerHTML).toContain("bg-destructive/15");
    root.unmount();
    el.remove();
  });

  it("search card shows hit count", async () => {
    const { el, root } = await renderCard(
      h(SearchCard, {
        tc: {
          id: "t4", title: "grep foo", kind: "search", status: "completed",
          rawInput: { pattern: "foo" },
          rawOutput: "a.ts:1: foo\nb.ts:2: foo bar",
        },
      } as any)
    );
    expect(el.innerHTML).toContain("2 命中");
    root.unmount();
    el.remove();
  });
});
