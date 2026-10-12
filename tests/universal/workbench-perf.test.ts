/**
 * 工作台流畅度 P0（文件树预取 / git 合并 / 保存中态）：纯逻辑 + saveTab 接线。
 * fs 层走全局 fetch mock（不断真实网关）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  HOVER_PREFETCH_MS,
  RefreshCoalescer,
  shouldPrefetchDir,
} from "@/components/workbench/FileTreePanel";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { saveTab } from "@/lib/workbench-actions";

const realFetch = globalThis.fetch;

beforeEach(() => {
  useWorkbenchStore.setState({ tabs: [], activeId: null });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  useWorkbenchStore.setState({ tabs: [], activeId: null });
});

describe("tree hover prefetch", () => {
  it("only prefetches unloaded dirs", () => {
    expect(HOVER_PREFETCH_MS).toBe(250);
    expect(shouldPrefetchDir({ type: "dir", loaded: false })).toBe(true);
    expect(shouldPrefetchDir({ type: "dir", loaded: true })).toBe(false);
    expect(shouldPrefetchDir({ type: "file" })).toBe(false);
    expect(shouldPrefetchDir(null)).toBe(false);
    expect(shouldPrefetchDir(undefined)).toBe(false);
  });
});

describe("RefreshCoalescer", () => {
  it("runs once, queues overlap, finish reports a rerun", () => {
    const c = new RefreshCoalescer();
    expect(c.begin()).toBe(true);
    expect(c.begin()).toBe(false);
    expect(c.begin()).toBe(false);
    expect(c.finish()).toBe(true); // 期间来过 → 需补跑
    expect(c.begin()).toBe(true);
    expect(c.finish()).toBe(false); // 期间没人来 → 不补跑
  });

  it("recovers after an exception path (finish always resets)", () => {
    const c = new RefreshCoalescer();
    expect(c.begin()).toBe(true);
    expect(c.finish()).toBe(false);
    expect(c.begin()).toBe(true);
  });
});

describe("saveTab saving state", () => {
  it("sets saving during the RTT and clears it on success", async () => {
    const wb = useWorkbenchStore.getState();
    wb.openTab({ id: "a.txt", path: "a.txt", kind: "file", text: "new", savedText: "old", mtimeMs: 1, loading: false });
    let resolveFetch!: (r: Response) => void;
    const spy = vi.fn(() => new Promise<Response>((res) => (resolveFetch = res)));
    globalThis.fetch = spy as unknown as typeof fetch;
    const p = saveTab("D:/r", "a.txt");
    expect(useWorkbenchStore.getState().tabs[0].saving).toBe(true);
    resolveFetch(Response.json({ ok: true, path: "a.txt", size: 3, mtimeMs: 2 }));
    expect(await p).toBe("saved");
    const t = useWorkbenchStore.getState().tabs[0];
    expect(t.saving).toBe(false);
    expect(t.savedText).toBe("new");
    expect(t.mtimeMs).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("coalesces a concurrent save into noop without a second request", async () => {
    const wb = useWorkbenchStore.getState();
    wb.openTab({ id: "b.txt", path: "b.txt", kind: "file", text: "new", savedText: "old", mtimeMs: 1, loading: false });
    wb.patchTab("b.txt", { saving: true });
    const spy = vi.fn(async () => new Response("{}"));
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await saveTab("D:/r", "b.txt")).toBe("noop");
    expect(spy).not.toHaveBeenCalled();
  });

  it("clears saving on error", async () => {
    const wb = useWorkbenchStore.getState();
    wb.openTab({ id: "c.txt", path: "c.txt", kind: "file", text: "new", savedText: "old", mtimeMs: 1, loading: false });
    globalThis.fetch = (async () => Response.json({ ok: false, error: "boom" }, { status: 500 })) as typeof fetch;
    expect(await saveTab("D:/r", "c.txt")).toBe("error");
    const t = useWorkbenchStore.getState().tabs[0];
    expect(t.saving).toBe(false);
    expect(t.error).toBe("boom");
  });
});

describe("openFile line jump (搜索结果定位）", () => {
  it("patches flashLines on already-open files without refetching", async () => {
    const wb = useWorkbenchStore.getState();
    wb.openTab({ id: "j.txt", path: "j.txt", kind: "file", text: "a\nb\n", savedText: "a\nb\n", mtimeMs: 1, loading: false });
    const spy = vi.fn(async () => new Response("{}"));
    globalThis.fetch = spy as unknown as typeof fetch;
    const { openFile } = await import("@/lib/workbench-actions");
    await openFile("D:/r", "j.txt", { line: 2 });
    expect(spy).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().tabs[0].flashLines).toEqual([2]);
  });
});
