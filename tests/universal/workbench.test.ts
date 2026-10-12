import { describe, expect, it, beforeEach } from "vitest";
import { changedLines } from "../../src/lib/fs-api";
import { matchesKey, registerCommands, runCommand, listCommands } from "../../src/lib/commands";
import { updateReducer, initialUpdateState } from "../../src/lib/update-state";
import { useWorkbenchStore, isDirty } from "../../src/stores/useWorkbenchStore";
import { buildGitMaps } from "../../src/components/workbench/FileTreePanel";

describe("changedLines", () => {
  it("reports inserted and modified lines in the new text (1-based)", () => {
    expect(changedLines("a\nb\nc", "a\nB\nc")).toEqual([2]);
    expect(changedLines("a\nc", "a\nb\nc")).toEqual([2]);
    expect(changedLines("a\nb\nc", "a\nc")).toEqual([]);
    expect(changedLines("", "x\ny")).toEqual([1, 2]);
    expect(changedLines("a\r\nb\r\nc", "a\nb\nc")).toEqual([]);
  });
});

describe("command registry", () => {
  it("runs registered commands, hides hidden ones, unregisters", async () => {
    let ran: unknown = null;
    const off = registerCommands([
      { id: "t.a", title: "A", run: (p) => { ran = p; } },
      { id: "t.hidden", title: "H", hidden: true, run: () => { ran = "h"; } },
      { id: "t.off", title: "Off", when: () => false, run: () => { ran = "off"; } },
    ]);
    expect(await runCommand("t.a", 42)).toBe(true);
    expect(ran).toBe(42);
    expect(await runCommand("t.hidden")).toBe(true);
    expect(await runCommand("t.off")).toBe(false);
    expect(listCommands().map((c) => c.id)).toEqual(expect.arrayContaining(["t.a"]));
    expect(listCommands().map((c) => c.id)).not.toContain("t.hidden");
    off();
    expect(await runCommand("t.a")).toBe(false);
  });
  it("matches key descriptors (Ctrl = Cmd on mac)", () => {
    const ev = (o: Partial<KeyboardEvent>) => ({ key: "p", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
    expect(matchesKey(ev({ key: "P", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+P", false)).toBe(true);
    expect(matchesKey(ev({ key: "p", metaKey: true, shiftKey: true }), "Ctrl+Shift+P", true)).toBe(true);
    expect(matchesKey(ev({ key: "p", ctrlKey: true }), "Ctrl+Shift+P", false)).toBe(false);
    expect(matchesKey(ev({ key: "s", ctrlKey: true }), "Ctrl+S", false)).toBe(true);
  });
});

describe("update reducer: up-to-date / disabled", () => {
  it("manual check with no update → up-to-date(manual)", () => {
    let s = updateReducer(initialUpdateState, { type: "checking", manual: true });
    s = updateReducer(s, { type: "not-available", version: "0.1.2" });
    expect(s).toMatchObject({ phase: "up-to-date", manual: true, version: "0.1.2" });
    expect(updateReducer(s, { type: "dismiss" })).toEqual({ phase: "idle" });
  });
  it("background check stays silent but never clobbers a ready update", () => {
    const silent = updateReducer(updateReducer(initialUpdateState, { type: "checking" }), { type: "not-available" });
    expect(silent).toMatchObject({ phase: "up-to-date", manual: false });
    const ready = updateReducer(initialUpdateState, { type: "downloaded", version: "9.9.9" });
    expect(updateReducer(ready, { type: "not-available" })).toBe(ready);
  });
  it("dev builds report disabled", () => {
    expect(updateReducer(initialUpdateState, { type: "disabled", manual: true })).toEqual({ phase: "disabled" });
  });
});

describe("workbench tabs", () => {
  beforeEach(() => useWorkbenchStore.setState({ tabs: [], activeId: null }));
  const base = { kind: "file" as const, text: "x", savedText: "x", mtimeMs: 1 };
  it("a new preview replaces the previous clean preview; pinned tabs stay", () => {
    const s = useWorkbenchStore.getState();
    s.openTab({ ...base, id: "a", path: "a" });
    s.openTab({ ...base, id: "b", path: "b" });
    expect(useWorkbenchStore.getState().tabs.map((t) => t.id)).toEqual(["b"]);
    s.pinTab("b");
    s.openTab({ ...base, id: "c", path: "c" });
    expect(useWorkbenchStore.getState().tabs.map((t) => t.id)).toEqual(["b", "c"]);
    expect(useWorkbenchStore.getState().activeId).toBe("c");
  });
  it("dirty previews are not replaced; closeAll keeps dirty tabs", () => {
    const s = useWorkbenchStore.getState();
    s.openTab({ ...base, id: "a", path: "a" });
    s.patchTab("a", { text: "changed" });
    expect(isDirty(useWorkbenchStore.getState().tabs[0])).toBe(true);
    s.openTab({ ...base, id: "b", path: "b" });
    expect(useWorkbenchStore.getState().tabs.map((t) => t.id)).toEqual(["a", "b"]);
    s.closeAll();
    expect(useWorkbenchStore.getState().tabs.map((t) => t.id)).toEqual(["a"]);
  });
  it("closing the active tab activates a neighbour", () => {
    const s = useWorkbenchStore.getState();
    for (const id of ["a", "b", "c"]) s.openTab({ ...base, id, path: id, preview: false });
    s.setActive("b");
    s.closeTab("b");
    expect(useWorkbenchStore.getState().activeId).toBe("c");
  });
  it("does not treat CRLF vs LF differences as dirty", () => {
    const s = useWorkbenchStore.getState();
    s.openTab({ ...base, id: "crlf", path: "crlf", text: "line1\nline2\n", savedText: "line1\r\nline2\r\n" });
    const tab = useWorkbenchStore.getState().tabs[0];
    expect(isDirty(tab)).toBe(false);
    s.patchTab("crlf", { text: "line1\nline2_modified\n" });
    expect(isDirty(useWorkbenchStore.getState().tabs[0])).toBe(true);
  });
});

describe("git badges", () => {
  it("maps files and marks ancestor dirs, honouring a repo sub-folder prefix", () => {
    const m = buildGitMaps([{ path: "pkg/src/a.ts", status: "M" }, { path: "other/b.ts", status: "?" }], "pkg/");
    expect(m.fileMap.get("src/a.ts")).toBe("M");
    expect(m.fileMap.has("other/b.ts")).toBe(false);
    expect(m.dirSet.has("src")).toBe(true);
  });
});
