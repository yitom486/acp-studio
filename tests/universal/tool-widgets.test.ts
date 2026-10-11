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
} from "@/components/assistant/AcpToolWidgets";
import {
  firstLines,
  isDiffText,
  lastLines,
  resolveWidgetKey,
  toolCommand,
  toolPath,
  toolText,
  isRawToolCallId,
  resolveToolDisplayTitle,
  friendlyToolActionName,
} from "@/components/assistant/tool-widget-utils";

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

    // camelCase / OpenCode tools
    expect(resolveWidgetKey({ title: "call_123", name: "readFile" })).toBe("file-read");
    expect(resolveWidgetKey({ title: "call_123", name: "listFiles" })).toBe("file-read");
    expect(resolveWidgetKey({ title: "call_123", name: "executeCommand" })).toBe("terminal");
    expect(resolveWidgetKey({ title: "call_123", name: "bash" })).toBe("terminal");
    expect(resolveWidgetKey({ title: "call_123", name: "searchFiles" })).toBe("search");
  });

  it("identifies raw machine toolCallIds vs human-readable titles", () => {
    expect(isRawToolCallId("call_01a12aca9593765283055503134294c8")).toBe(true);
    expect(isRawToolCallId("tc-1791719322-a9b1")).toBe(true);
    expect(isRawToolCallId("Tool call")).toBe(true);
    expect(isRawToolCallId("读取文件: package.json")).toBe(false);
    expect(isRawToolCallId("Get-ChildItem -Recurse")).toBe(false);
    expect(isRawToolCallId("")).toBe(false);
  });

  it("resolves friendly display titles when title is a raw toolCallId or empty", () => {
    // 1. Raw call id with readFile and path
    expect(
      resolveToolDisplayTitle({
        id: "call_01a12aca9593765283055503134294c8",
        title: "call_01a12aca9593765283055503134294c8",
        name: "readFile",
        rawInput: { path: "package.json" },
      })
    ).toBe("读取文件: package.json");

    // 2. Raw call id with listFiles and dir
    expect(
      resolveToolDisplayTitle({
        id: "call_01a12aca9e1376de89e7a93e1faff70e",
        title: "call_01a12aca9e1376de89e7a93e1faff70e",
        name: "listFiles",
        rawInput: { directory: "src" },
      })
    ).toBe("浏览目录: src");

    // 3. Raw call id with bash command
    expect(
      resolveToolDisplayTitle({
        id: "call_01a12aca9ef67101b765938f32d4d5c5",
        title: "call_01a12aca9ef67101b765938f32d4d5c5",
        name: "bash",
        rawInput: { command: "npm test" },
      })
    ).toBe("执行命令: npm test");

    // 4. Already human-readable title remains intact
    expect(
      resolveToolDisplayTitle({
        id: "call_01a12acaa0737721b570c076e3552e12",
        title: "Running tool: view_file (server/index.ts)",
        name: "view_file",
      })
    ).toBe("Running tool: view_file (server/index.ts)");

    // 5. Fallback with only raw id
    expect(
      resolveToolDisplayTitle({
        id: "call_01a12acaafd576e299dc4e521efd5f52",
        title: "call_01a12acaafd576e299dc4e521efd5f52",
      })
    ).toBe("工具调用 (call_01a…)");
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
