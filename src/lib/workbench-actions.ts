/** 编辑器动作：打开 / 保存 / 冲突处理 / 响应文件监听。纯函数式地操作 useWorkbenchStore。 */
import { useWorkbenchStore, isDirty, type EditorTab } from "@/stores/useWorkbenchStore";
import { fsRead, fsWrite, changedLines, FsApiError, type FsWatchEvent } from "@/lib/fs-api";
import { gitFile } from "@/lib/universal-api";

const st = () => useWorkbenchStore.getState();

export async function openFile(cwd: string, path: string, opts: { pin?: boolean; line?: number } = {}) {
  const id = path;
  const existing = st().tabs.find((t) => t.id === id);
  st().openTab({ id, path, kind: "file", text: existing?.text ?? "", savedText: existing?.savedText ?? "", mtimeMs: existing?.mtimeMs ?? null, loading: !existing, preview: !opts.pin });
  if (existing && !existing.error) {
    // 已打开：只定位（搜索结果跳行用），不重读
    if (opts.line) st().patchTab(id, { flashLines: [opts.line], flashAt: Date.now() });
    return;
  }
  try {
    const f = await fsRead(cwd, path);
    const hasCrlf = f.text.includes("\r\n");
    const normalized = f.text.replace(/\r\n/g, "\n");
    st().patchTab(id, {
      text: normalized,
      savedText: normalized,
      eol: hasCrlf ? "\r\n" : "\n",
      mtimeMs: f.mtimeMs,
      loading: false,
      error: undefined,
      ...(opts.line ? { flashLines: [opts.line], flashAt: Date.now() } : null),
    });
  } catch (e) {
    st().patchTab(id, { loading: false, error: (e as Error).message });
  }
}

export async function openDiff(cwd: string, path: string) {
  const id = `diff:${path}`;
  st().openTab({ id, path, kind: "diff", text: "", savedText: "", mtimeMs: null, loading: true, preview: false });
  try {
    const d = await gitFile(cwd, path);
    if (d.binary) throw new Error("二进制文件不支持对比");
    // diff 标签：savedText = HEAD 版本，text = 工作区版本（只读）
    st().patchTab(id, {
      savedText: (d.before ?? "").replace(/\r\n/g, "\n"),
      text: (d.after ?? "").replace(/\r\n/g, "\n"),
      loading: false,
    });
  } catch (e) {
    st().patchTab(id, { loading: false, error: (e as Error).message });
  }
}

export type SaveResult = "saved" | "conflict" | "error" | "noop";

export async function saveTab(cwd: string, id: string, opts: { force?: boolean } = {}): Promise<SaveResult> {
  const tab = st().tabs.find((t) => t.id === id);
  if (!tab || tab.kind !== "file" || tab.loading) return "noop";
  // 与进行中的保存合并：UI 有 saving 态，不静默吞第二次保存
  if (tab.saving) return "noop";
  if (!isDirty(tab) && !opts.force) return "noop";
  st().patchTab(id, { saving: true, error: undefined });
  try {
    const textToWrite = tab.eol === "\r\n" ? tab.text.replace(/\r?\n/g, "\r\n") : tab.text;
    const r = await fsWrite(cwd, tab.path, textToWrite, tab.mtimeMs, opts.force);
    st().patchTab(id, { savedText: tab.text, mtimeMs: r.mtimeMs, conflict: null, preview: false, saving: false });
    return "saved";
  } catch (e) {
    if (e instanceof FsApiError && e.status === 409) {
      st().patchTab(id, { conflict: { text: e.data.text ?? "", mtimeMs: e.data.mtimeMs ?? 0 }, saving: false });
      return "conflict";
    }
    st().patchTab(id, { error: (e as Error).message, saving: false });
    return "error";
  }
}

/** 冲突条：用磁盘版本（丢弃本地改动） */
export function acceptDisk(id: string) {
  const tab = st().tabs.find((t) => t.id === id);
  if (!tab?.conflict) return;
  const hasCrlf = tab.conflict.text.includes("\r\n");
  const normalized = tab.conflict.text.replace(/\r\n/g, "\n");
  st().patchTab(id, {
    text: normalized,
    savedText: normalized,
    eol: hasCrlf ? "\r\n" : "\n",
    mtimeMs: tab.conflict.mtimeMs,
    conflict: null,
  });
}

/** 文件监听批次 → 已打开的标签：未改动则自动重载并高亮变化行；有未保存改动则进冲突态。 */
export async function applyWatchEvents(cwd: string, events: FsWatchEvent[]) {
  const touched = new Set(events.map((e) => e.path));
  const removed = new Set(events.filter((e) => e.type === "unlink").map((e) => e.path));
  const tabs = st().tabs.filter((t: EditorTab) => t.kind === "file" && touched.has(t.path) && !t.loading);
  await Promise.all(
    tabs.map(async (t) => {
      if (removed.has(t.path)) {
        st().patchTab(t.id, { error: "文件已在磁盘上被删除" });
        return;
      }
      try {
        const f = await fsRead(cwd, t.path);
        const cur = st().tabs.find((x) => x.id === t.id);
        if (!cur) return;
        const hasCrlf = f.text.includes("\r\n");
        const normalized = f.text.replace(/\r\n/g, "\n");
        if (f.mtimeMs === cur.mtimeMs || normalized === cur.savedText) {
          if (f.mtimeMs !== cur.mtimeMs) st().patchTab(t.id, { mtimeMs: f.mtimeMs });
          return;
        }
        if (isDirty(cur)) {
          st().patchTab(t.id, { conflict: { text: f.text, mtimeMs: f.mtimeMs } });
        } else {
          st().patchTab(t.id, {
            text: normalized,
            savedText: normalized,
            eol: hasCrlf ? "\r\n" : "\n",
            mtimeMs: f.mtimeMs,
            error: undefined,
            flashLines: changedLines(cur.savedText, normalized),
            flashAt: Date.now(),
          });
        }
      } catch {
        // 读失败（比如被删除后又写入中）：下一批事件再处理
      }
    }),
  );
}
