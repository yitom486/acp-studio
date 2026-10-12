/**
 * 编辑器区：标签页（预览 / 固定 / 未保存圆点）+ CodeMirror 6 编辑器 + @codemirror/merge 对比视图。
 * 每个标签保留自己的 EditorState（撤销历史、光标、滚动），切换标签不丢。
 */
import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { X, Circle, GitCompare, Columns2, Rows2, AlertTriangle, Loader2 } from "lucide-react";
import { useWorkbenchStore, isDirty, type EditorTab } from "@/stores/useWorkbenchStore";
import { saveTab, acceptDisk, openDiff } from "@/lib/workbench-actions";
import { baseExtensions, languageFor, setFlashLines } from "./codemirror-setup";
import { cn } from "@/lib/utils";

const NotebookViewer = lazy(() => import("./NotebookViewer"));
const MarkdownWysiwyg = lazy(() => import("./MarkdownWysiwyg"));

export const isNotebook = (p: string) => /\.ipynb$/i.test(p);
export const isMarkdown = (p: string) => /\.(md|markdown)$/i.test(p);
export function viewOf(t: EditorTab): "source" | "wysiwyg" | "notebook" {
  if (t.view) return t.view;
  return isNotebook(t.path) ? "notebook" : "source";
}

const states = new Map<string, EditorState>();
const langCompartment = new Compartment();

function buildState(tab: EditorTab, onChange: (text: string) => void): EditorState {
  return EditorState.create({
    doc: tab.text,
    extensions: [
      baseExtensions(),
      langCompartment.of([]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
    ],
  });
}

const FileEditor: React.FC<{ tab: EditorTab }> = ({ tab }) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const tabId = tab.id;

  useEffect(() => {
    if (!host.current) return;
    const onChange = (text: string) => {
      const st = useWorkbenchStore.getState();
      const cur = st.tabs.find((t) => t.id === tabId);
      if (!cur || cur.text === text) return;
      st.patchTab(tabId, { text, ...(cur.preview ? { preview: false } : {}) }); // 开始编辑 = 固定标签
    };
    const v = new EditorView({ state: states.get(tabId) ?? buildState(tab, onChange), parent: host.current });
    view.current = v;
    let cancelled = false;
    void languageFor(tab.path).then((lang) => {
      if (!cancelled && lang) v.dispatch({ effects: langCompartment.reconfigure(lang) });
    });
    return () => {
      cancelled = true;
      states.set(tabId, v.state);
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // 外部重载（磁盘 / AI 修改、冲突时选用磁盘版本）：文本和编辑器不一致时替换
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc.toString();
    if (doc !== tab.text) {
      v.dispatch({ changes: { from: 0, to: doc.length, insert: tab.text } });
    }
  }, [tab.text]);

  useEffect(() => {
    const v = view.current;
    if (!v || !tab.flashLines?.length) return;
    v.dispatch({ effects: setFlashLines.of(tab.flashLines) });
    const first = tab.flashLines[0];
    if (first <= v.state.doc.lines) v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(first).from, { y: "center" }) });
  }, [tab.flashAt, tab.flashLines]);

  return <div ref={host} className="h-full overflow-hidden" />;
};

const DiffViewer: React.FC<{ tab: EditorTab; mode: "split" | "unified" }> = ({ tab, mode }) => {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    let destroy = () => {};
    let cancelled = false;
    void languageFor(tab.path).then((lang) => {
      if (cancelled || !host.current) return;
      const ext = [baseExtensions({ readOnly: true }), lang ?? []];
      if (mode === "split") {
        const mv = new MergeView({
          a: { doc: tab.savedText, extensions: ext },
          b: { doc: tab.text, extensions: ext },
          parent: host.current,
          collapseUnchanged: { margin: 3, minSize: 6 },
          gutter: true,
        });
        destroy = () => mv.destroy();
      } else {
        const v = new EditorView({
          state: EditorState.create({
            doc: tab.text,
            extensions: [ext, unifiedMergeView({ original: tab.savedText, mergeControls: false, collapseUnchanged: { margin: 3, minSize: 6 } })],
          }),
          parent: host.current,
        });
        destroy = () => v.destroy();
      }
    });
    return () => {
      cancelled = true;
      destroy();
    };
  }, [tab.text, tab.savedText, tab.path, mode]);
  return <div ref={host} className="acp-merge h-full overflow-auto" />;
};

export const EditorPane: React.FC<{ cwd: string | null }> = ({ cwd }) => {
  const tabs = useWorkbenchStore((s) => s.tabs);
  const activeId = useWorkbenchStore((s) => s.activeId);
  const { setActive, closeTab, pinTab, closeOthers } = useWorkbenchStore.getState();
  // 窄屏默认统一视图，宽屏默认并排
  const [diffMode, setDiffMode] = useState<"split" | "unified">(() => (typeof window !== "undefined" && window.innerWidth < 1600 ? "unified" : "split"));
  const active = tabs.find((t) => t.id === activeId) ?? null;

  useEffect(() => {
    for (const id of [...states.keys()]) if (!tabs.some((t) => t.id === id)) states.delete(id);
  }, [tabs]);

  const requestClose = (t: EditorTab) => {
    if (isDirty(t) && !window.confirm(`${t.path} 有未保存的修改，确定关闭？`)) return;
    closeTab(t.id);
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div role="tablist" className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-border bg-muted/30">
        {tabs.map((t) => {
          const dirty = isDirty(t);
          const name = t.path.split("/").pop();
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === activeId}
              title={t.path}
              onClick={() => setActive(t.id)}
              onDoubleClick={() => pinTab(t.id)}
              onAuxClick={(e) => e.button === 1 && requestClose(t)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (window.confirm("关闭其他标签页？（未保存的会保留）")) closeOthers(t.id);
              }}
              className={cn(
                "group flex h-full max-w-56 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-[12.5px]",
                t.id === activeId ? "bg-background text-foreground shadow-[inset_0_1px_0_hsl(var(--foreground))]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.kind === "diff" && <GitCompare className="h-3.5 w-3.5 shrink-0" />}
              <span className={cn("truncate", t.preview && "italic")}>{name}{t.kind === "diff" ? " (对比)" : ""}</span>
              <button
                aria-label={dirty ? "未保存，点击关闭" : "关闭"}
                onClick={(e) => { e.stopPropagation(); requestClose(t); }}
                className="ml-0.5 flex h-4 w-4 items-center justify-center rounded hover:bg-accent"
              >
                {dirty ? (
                  <>
                    <Circle className="h-2 w-2 fill-current group-hover:hidden" />
                    <X className="hidden h-3 w-3 group-hover:block" />
                  </>
                ) : (
                  <X className={cn("h-3 w-3", t.id !== activeId && "opacity-0 group-hover:opacity-100")} />
                )}
              </button>
            </div>
          );
        })}
        <div className="flex-1" />
        {active?.kind === "diff" && (
          <div className="flex h-full items-center gap-1 px-2 text-muted-foreground">
            <button title="并排对比" onClick={() => setDiffMode("split")} className={cn("rounded p-1 hover:bg-accent", diffMode === "split" && "text-foreground bg-accent")}><Columns2 className="h-3.5 w-3.5" /></button>
            <button title="统一对比" onClick={() => setDiffMode("unified")} className={cn("rounded p-1 hover:bg-accent", diffMode === "unified" && "text-foreground bg-accent")}><Rows2 className="h-3.5 w-3.5" /></button>
          </div>
        )}
        {active?.kind === "file" && (isMarkdown(active.path) || isNotebook(active.path)) && (
          <div className="mr-1 flex h-6 items-center rounded-md border border-border p-0.5 text-[11px]" role="group" aria-label="视图">
            {(isNotebook(active.path) ? (["notebook", "source"] as const) : (["source", "wysiwyg"] as const)).map((v) => (
              <button
                key={v}
                onClick={() => useWorkbenchStore.getState().patchTab(active.id, { view: v })}
                className={cn("rounded px-2 py-0.5", viewOf(active) === v ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {v === "source" ? "源码" : v === "wysiwyg" ? "所见即所得" : "预览"}
              </button>
            ))}
          </div>
        )}
        {active?.kind === "file" && cwd && (
          <div className="flex h-full items-center gap-1 px-2 text-[11px] text-muted-foreground">
            <button className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground" onClick={() => void openDiff(cwd, active.path)} title="与 HEAD 对比">
              <GitCompare className="inline h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {active?.conflict && cwd && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-warning/10 px-3 py-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
          <span className="flex-1">磁盘上的文件已被修改（可能是 AI 改的），而你有未保存的改动。</span>
          <button className="rounded border border-border px-2 py-0.5 hover:bg-accent" onClick={() => acceptDisk(active.id)}>用磁盘版本</button>
          <button className="rounded border border-border px-2 py-0.5 hover:bg-accent" onClick={() => void saveTab(cwd, active.id, { force: true })}>覆盖保存</button>
          <button className="rounded border border-border px-2 py-0.5 hover:bg-accent" onClick={() => void openDiff(cwd, active.path)}>对比</button>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        {!active ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">在文件树里单击预览、双击固定打开文件</div>
        ) : active.loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在打开…</div>
        ) : active.error && active.kind === "file" && !active.text ? (
          <div className="flex h-full items-center justify-center text-xs text-destructive">{active.error}</div>
        ) : active.kind === "diff" ? (
          <DiffViewer key={active.id + diffMode} tab={active} mode={diffMode} />
        ) : viewOf(active) === "notebook" ? (
          <Suspense fallback={<div className="p-4 text-xs text-muted-foreground">正在加载笔记本查看器…</div>}>
            <NotebookViewer text={active.text} />
          </Suspense>
        ) : viewOf(active) === "wysiwyg" ? (
          <Suspense fallback={<div className="p-4 text-xs text-muted-foreground">正在加载所见即所得编辑器…</div>}>
            <MarkdownWysiwyg
              key={active.id + ":wysiwyg"}
              value={active.text}
              original={active.savedText}
              onChange={(text) => {
                const cur = useWorkbenchStore.getState().tabs.find((t) => t.id === active.id);
                if (cur && cur.text !== text) useWorkbenchStore.getState().patchTab(active.id, { text, preview: false });
              }}
            />
          </Suspense>
        ) : (
          <FileEditor key={active.id} tab={active} />
        )}
      </div>

      {active && (
        <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border px-3 font-mono text-[11px] text-muted-foreground">
          <span className="truncate">{active.path}</span>
          <span className="flex-1" />
          {active.kind === "file" && (isDirty(active) ? <span className="text-warning">● 未保存 · Ctrl/⌘+S 保存</span> : <span>已保存</span>)}
          {active.kind === "diff" && <span>HEAD ↔ 工作区（只读）</span>}
        </div>
      )}
    </div>
  );
};

export default EditorPane;
