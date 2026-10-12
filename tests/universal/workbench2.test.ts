import { describe, expect, it } from "vitest";
import { relativeToWorkspace, classifyOutsideFile, collectFolderFiles, decodeDragRefs, encodeDragRefs, stripMentionText, OUTSIDE_FILE_MAX, FOLDER_FILE_CAP } from "../../src/lib/composer-drop";
import { closeOpenFences, hasMath } from "../../src/lib/markdown-preprocess";
import { parseNotebook, pickOutput } from "../../src/lib/notebook";
import { splitBlocks, normalizeMarkdown, preserveUnchangedBlocks } from "../../src/lib/markdown-roundtrip";

describe("composer drop", () => {
  it("maps absolute paths inside the workspace to relative refs (posix + windows)", () => {
    expect(relativeToWorkspace("/home/u/proj", "/home/u/proj/src/a.ts")).toBe("src/a.ts");
    expect(relativeToWorkspace("/home/u/proj/", "/home/u/proj")).toBe("");
    expect(relativeToWorkspace("/home/u/proj", "/home/u/project2/a.ts")).toBeNull();
    expect(relativeToWorkspace("/home/u/proj", "/etc/passwd")).toBeNull();
    expect(relativeToWorkspace("C:\\Work\\Proj", "c:\\work\\proj\\src\\A.ts")).toBe("src/A.ts");
    expect(relativeToWorkspace("C:\\Work\\Proj", "D:\\x.ts")).toBeNull();
  });
  it("classifies outside files: images need image capability, size limits apply", () => {
    expect(classifyOutsideFile({ type: "image/png", size: 1000 }, false)).toBe("reject-image");
    expect(classifyOutsideFile({ type: "image/png", size: 1000 }, true)).toBe("image");
    expect(classifyOutsideFile({ type: "text/plain", size: 1000 }, false)).toBe("text");
    expect(classifyOutsideFile({ type: "text/plain", size: 600 * 1024 }, false)).toBe("link");
    expect(classifyOutsideFile({ type: "application/zip", size: OUTSIDE_FILE_MAX + 1 }, false)).toBe("reject-size");
  });
  it("collects folder files breadth-first with a cap", async () => {
    const tree: Record<string, Array<{ path: string; type: string }>> = {
      src: [{ path: "src/lib", type: "dir" }, ...Array.from({ length: 15 }, (_, i) => ({ path: `src/f${i}.ts`, type: "file" }))],
      "src/lib": Array.from({ length: 15 }, (_, i) => ({ path: `src/lib/g${i}.ts`, type: "file" })),
    };
    const r = await collectFolderFiles("src", async (d) => tree[d] || []);
    expect(r.files).toHaveLength(FOLDER_FILE_CAP);
    expect(r.truncated).toBe(true);
    expect(r.files[0]).toBe("src/f0.ts");
    const small = await collectFolderFiles("src/lib", async (d) => tree[d] || [], 50);
    expect(small).toEqual({ files: tree["src/lib"].map((f) => f.path), truncated: false });
  });
  it("round-trips drag payloads and rejects traversal", () => {
    expect(decodeDragRefs(encodeDragRefs([{ path: "a/b.ts", kind: "file" }]))).toEqual([{ path: "a/b.ts", kind: "file" }]);
    expect(decodeDragRefs('[{"path":"../x","kind":"file"}]')).toEqual([]);
    expect(decodeDragRefs("not json")).toEqual([]);
  });
  it("strips the @path text when a chip is removed", () => {
    expect(stripMentionText("看看 @src/a.ts 和 @src/b.ts ", "src/a.ts")).toBe("看看 和 @src/b.ts ");
    expect(stripMentionText("@src/ 全部", "src")).toBe("全部");
    expect(stripMentionText("@src/a.tsx", "src/a.ts")).toBe("@src/a.tsx");
  });
});

describe("markdown preprocess", () => {
  it("closes an unfinished fence and drops a half-typed fence line", () => {
    expect(closeOpenFences("text\n```ts\nconst a = 1")).toBe("text\n```ts\nconst a = 1\n```");
    expect(closeOpenFences("done\n``")).toBe("done");
    expect(closeOpenFences("```\na\n```\nafter")).toBe("```\na\n```\nafter");
    expect(closeOpenFences("````md\n```js\nx\n```\n")).toBe("````md\n```js\nx\n```\n````");
  });
  it("detects math but not prices", () => {
    expect(hasMath("面积 $\\pi r^2$")).toBe(true);
    expect(hasMath("$$\nE=mc^2\n$$")).toBe(true);
    expect(hasMath("\\(a+b\\)")).toBe(true);
    expect(hasMath("价格 $5 到 $10")).toBe(false);
    expect(hasMath("no math")).toBe(false);
  });
});

describe("notebook", () => {
  const nb = {
    nbformat: 4, nbformat_minor: 5,
    metadata: { language_info: { name: "python" } },
    cells: [
      { cell_type: "markdown", source: ["# Title\n", "text"], metadata: {} },
      { cell_type: "code", execution_count: 3, source: "print(1)", metadata: {}, outputs: [
        { output_type: "stream", name: "stdout", text: ["1\n"] },
        { output_type: "execute_result", execution_count: 3, metadata: {}, data: { "text/plain": "2", "text/html": "<b>2</b>" } },
        { output_type: "display_data", metadata: {}, data: { "image/png": "iVBORw0K\nGgo=" } },
        { output_type: "error", ename: "ValueError", evalue: "bad", traceback: ["\u001b[31mTraceback\u001b[0m", "line"] },
      ] },
    ],
  };
  it("parses cells and outputs with Jupyter MIME priority", () => {
    const v = parseNotebook(JSON.stringify(nb));
    expect(v.language).toBe("python");
    expect(v.cells[0]).toMatchObject({ type: "markdown", source: "# Title\ntext" });
    expect(v.cells[1].executionCount).toBe(3);
    const o = v.cells[1].outputs;
    expect(o[0]).toEqual({ kind: "text", text: "1\n", stream: "stdout" });
    expect(o[1]).toEqual({ kind: "html", html: "<b>2</b>" });
    expect(o[2]).toEqual({ kind: "image", mime: "image/png", src: "data:image/png;base64,iVBORw0KGgo=" });
    expect(o[3]).toMatchObject({ kind: "error", ename: "ValueError", traceback: "Traceback\nline" });
  });
  it("renders svg as a data URL image (never inline markup) and rejects bad files", () => {
    expect(pickOutput({ "image/svg+xml": "<svg onload=alert(1)/>" })).toMatchObject({ kind: "image", src: expect.stringMatching(/^data:image\/svg\+xml/) });
    expect(() => parseNotebook("{")).toThrow(/JSON/);
    expect(() => parseNotebook('{"nbformat":3,"cells":[]}')).toThrow(/nbformat 3/);
  });
});

describe("markdown round-trip guard", () => {
  const original = "# Title\n\n* one\n* two\n\nSome __bold__ text.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n";
  const baseline = "# Title\n\n- one\n- two\n\nSome **bold** text.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n";
  it("keeps code fences as one block", () => {
    expect(splitBlocks(original)).toHaveLength(4);
  });
  it("returns the original bytes when only formatting changed", () => {
    expect(preserveUnchangedBlocks(original, baseline, baseline)).toEqual({ text: original, unchanged: true, reformatted: false });
    expect(normalizeMarkdown(original)).toBe(normalizeMarkdown(baseline));
  });
  it("only rewrites the edited block", () => {
    const edited = baseline.replace("Some **bold** text.", "Some **bold** text, edited.");
    const r = preserveUnchangedBlocks(original, baseline, edited);
    expect(r.unchanged).toBe(false);
    expect(r.text).toContain("* one\n* two");
    expect(r.text).toContain("Some **bold** text, edited.");
    expect(r.text.endsWith("\n")).toBe(true);
  });
  it("handles inserted blocks and falls back when blocks can't be aligned", () => {
    const edited = baseline.replace("# Title\n\n", "# Title\n\nNew paragraph.\n\n");
    expect(preserveUnchangedBlocks(original, baseline, edited).text).toContain("New paragraph.\n\n* one");
    const r = preserveUnchangedBlocks("a\nb", "a\n\nb", "a\n\nb\n\nc");
    expect(r.reformatted).toBe(true);
  });
});
