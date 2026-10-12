/**
 * 工作区文件树：react-arborist（虚拟滚动 + 完整键盘导航 + 拖拽移动 + 行内重命名），
 * 目录懒加载（/fs/list），文件监听（/fs/watch）自动刷新，git 状态徽标（/git/status）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from "react-arborist";
import {
  ChevronRight, File, FileCode2, FileJson, FileText, Folder, FolderOpen, FilePlus2, FolderPlus, RefreshCw, ChevronsDownUp, Image as ImageIcon, Link2,
} from "lucide-react";
import { fsCreate, fsDelete, fsList, fsRename, fsWatch, type FsEntry } from "@/lib/fs-api";
import { gitStatus } from "@/lib/universal-api";
import { openDiff, openFile, applyWatchEvents } from "@/lib/workbench-actions";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/error-bus";

interface TreeNode {
  id: string; // 相对路径
  name: string;
  type: FsEntry["type"];
  symlink?: boolean;
  children?: TreeNode[] | null; // dir: 数组（未加载为空数组 + loaded=false）；file: null
  loaded?: boolean;
}

const toNode = (e: FsEntry): TreeNode => ({
  id: e.path,
  name: e.name,
  type: e.type,
  symlink: e.symlink,
  children: e.type === "dir" ? [] : null,
  loaded: false,
});

function replaceChildren(nodes: TreeNode[], dir: string, children: TreeNode[]): TreeNode[] {
  if (dir === "") return mergeLoaded(nodes, children);
  return nodes.map((n) => {
    if (n.id === dir) return { ...n, children: mergeLoaded(n.children || [], children), loaded: true };
    if (n.children && dir.startsWith(n.id + "/")) return { ...n, children: replaceChildren(n.children, dir, children) };
    return n;
  });
}
/** 刷新一层时保留已展开子目录的子树 */
function mergeLoaded(old: TreeNode[], fresh: TreeNode[]): TreeNode[] {
  const byId = new Map(old.map((n) => [n.id, n]));
  return fresh.map((n) => {
    const prev = byId.get(n.id);
    return prev && prev.type === "dir" && n.type === "dir" && prev.loaded ? { ...n, children: prev.children, loaded: true } : n;
  });
}
function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children && id.startsWith(n.id + "/")) {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
}

export const STATUS_LABEL: Record<string, string> = { M: "已修改", A: "已添加", D: "已删除", R: "已重命名", "?": "未跟踪", U: "冲突", C: "已复制" };
export function statusClass(s: string): string {
  if (s === "D" || s === "U") return "text-destructive";
  if (s === "A" || s === "?") return "text-success";
  return "text-warning";
}

/** 文件状态 → 所在目录汇总（目录显示一个圆点） */
export function buildGitMaps(files: Array<{ path: string; status: string }>, prefix = "") {
  const fileMap = new Map<string, string>();
  const dirSet = new Set<string>();
  for (const f of files) {
    let p = f.path;
    if (prefix) {
      if (!p.startsWith(prefix)) continue;
      p = p.slice(prefix.length);
    }
    p = p.replace(/\/$/, "");
    fileMap.set(p, f.status);
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirSet.add(parts.slice(0, i).join("/"));
  }
  return { fileMap, dirSet };
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "sh", "vue", "svelte"].includes(ext)) return FileCode2;
  if (["json", "jsonc"].includes(ext)) return FileJson;
  if (["md", "markdown", "txt", "log", "yml", "yaml", "toml"].includes(ext)) return FileText;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext)) return ImageIcon;
  return File;
}

const joinAbs = (cwd: string, rel: string) => {
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return rel ? `${cwd.replace(/[\\/]$/, "")}${sep}${rel.split("/").join(sep)}` : cwd;
};

interface MenuState { x: number; y: number; node: TreeNode | null }

export const FileTreePanel: React.FC<{ cwd: string | null }> = ({ cwd }) => {
  const [data, setData] = useState<TreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [git, setGit] = useState(() => buildGitMaps([]));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const treeRef = useRef<TreeApi<TreeNode> | undefined>(undefined);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 240, h: 400 });
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const dataRef = useRef(data);
  dataRef.current = data;
  const activeId = useWorkbenchStore((s) => s.activeId);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loadDir = useCallback(async (dir: string) => {
    if (!cwd) return;
    try {
      const entries = await fsList(cwd, dir);
      setData((d) => replaceChildren(d, dir, entries.map(toNode)));
      setError(null);
    } catch (e) {
      if (dir === "") setError((e as Error).message);
    }
  }, [cwd]);

  const refreshGit = useCallback(async () => {
    if (!cwd) return;
    try {
      const r = await gitStatus(cwd);
      const repo = (r.repo || "").replace(/\\/g, "/");
      const here = cwd.replace(/\\/g, "/");
      const prefix = here.startsWith(repo + "/") ? here.slice(repo.length + 1) + "/" : "";
      setGit(buildGitMaps(r.files, prefix));
    } catch {
      setGit(buildGitMaps([])); // 不是 git 仓库
    }
  }, [cwd]);

  useEffect(() => {
    setData([]);
    if (!cwd) return;
    void loadDir("");
    void refreshGit();
    let gitTimer: ReturnType<typeof setTimeout> | null = null;
    const stop = fsWatch(cwd, (events) => {
      const dirs = new Set(events.map((e) => (e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "")));
      for (const d of dirs) {
        const n = d === "" ? null : findNode(dataRef.current, d);
        if (d === "" || n?.loaded) void loadDir(d);
      }
      void applyWatchEvents(cwd, events);
      if (gitTimer) clearTimeout(gitTimer);
      gitTimer = setTimeout(() => void refreshGit(), 300);
    });
    return () => {
      stop();
      if (gitTimer) clearTimeout(gitTimer);
    };
  }, [cwd, loadDir, refreshGit]);

  const onToggle = useCallback((id: string) => {
    const n = findNode(dataRef.current, id);
    if (n && n.type === "dir" && !n.loaded) void loadDir(id);
  }, [loadDir]);

  const parentOf = (id: string) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "");

  const guard = async (fn: () => Promise<unknown>, what: string) => {
    try {
      await fn();
    } catch (e) {
      reportError("文件树", new Error(`${what}失败：${(e as Error).message}`));
    }
  };

  const createIn = async (dirId: string, type: "file" | "dir") => {
    if (!cwd) return;
    const name = window.prompt(type === "file" ? "新文件名" : "新文件夹名");
    if (!name) return;
    const rel = dirId ? `${dirId}/${name}` : name;
    await guard(async () => {
      await fsCreate(cwd, rel, type);
      await loadDir(dirId);
      if (type === "file") void openFile(cwd, rel, { pin: true });
    }, "新建");
  };

  const ctxItems = (node: TreeNode | null) => {
    if (!cwd) return [];
    const dirId = node ? (node.type === "dir" ? node.id : parentOf(node.id)) : "";
    const wb = window.acpStudio?.workbench;
    const copy = (t: string) => (wb ? wb.copyText(t) : navigator.clipboard.writeText(t));
    const items: Array<{ label: string; run: () => void; danger?: boolean } | "sep"> = [
      { label: "新建文件…", run: () => void createIn(dirId, "file") },
      { label: "新建文件夹…", run: () => void createIn(dirId, "dir") },
    ];
    if (node) {
      items.push("sep");
      if (node.type === "file") items.push({ label: "打开（固定标签）", run: () => void openFile(cwd, node.id, { pin: true }) });
      if (node.type === "file" && git.fileMap.has(node.id)) items.push({ label: "查看改动对比", run: () => void openDiff(cwd, node.id) });
      items.push(
        { label: "重命名…", run: () => treeRef.current?.get(node.id)?.edit() },
        { label: "删除（移到回收站）", danger: true, run: () => void guard(async () => {
          if (!window.confirm(`把 ${node.id} 移到回收站？`)) return;
          await fsDelete(cwd, node.id);
          await loadDir(parentOf(node.id));
          const st = useWorkbenchStore.getState();
          st.tabs.filter((t) => t.path === node.id || t.path.startsWith(node.id + "/")).forEach((t) => st.closeTab(t.id));
        }, "删除") },
        "sep",
      );
    }
    const abs = joinAbs(cwd, node?.id || "");
    if (wb) items.push({ label: "在文件管理器中显示", run: () => void wb.reveal(abs) });
    items.push({ label: "复制路径", run: () => void copy(abs) });
    if (node) items.push({ label: "复制相对路径", run: () => void copy(node.id) });
    return items;
  };

  const Node = useMemo(() => {
    const Comp = ({ node, style, dragHandle }: NodeRendererProps<TreeNode>) => {
      const d = node.data;
      const isDir = d.type === "dir";
      const st = isDir ? null : git.fileMap.get(d.id);
      const dirChanged = isDir && git.dirSet.has(d.id);
      const Icon = isDir ? (node.isOpen ? FolderOpen : Folder) : d.type === "other" ? Link2 : fileIcon(d.name);
      return (
        <div
          ref={dragHandle}
          style={style}
          className={cn(
            "group flex h-full items-center gap-1 pr-2 text-[13px] cursor-pointer select-none rounded-sm",
            node.isSelected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            node.isFocused && !node.isSelected && "bg-accent/40",
            d.id === activeId && !node.isSelected && "text-foreground",
          )}
          onClick={() => {
            if (isDir) node.toggle();
            else if (cwdRef.current && d.type === "file") void openFile(cwdRef.current, d.id, { pin: false });
          }}
          onDoubleClick={() => {
            if (!isDir && cwdRef.current && d.type === "file") void openFile(cwdRef.current, d.id, { pin: true });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            node.select();
            setMenu({ x: e.clientX, y: e.clientY, node: d });
          }}
          title={st ? `${d.id} · ${STATUS_LABEL[st] || st}` : d.id}
        >
          <span className="w-3.5 shrink-0 flex justify-center">
            {isDir && <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", node.isOpen && "rotate-90")} />}
          </span>
          <Icon className={cn("h-3.5 w-3.5 shrink-0", isDir ? "text-foreground/70" : "text-muted-foreground")} />
          {node.isEditing ? (
            <input
              autoFocus
              defaultValue={d.name}
              className="h-5 flex-1 min-w-0 rounded-sm border border-ring bg-background px-1 text-[13px] text-foreground outline-none"
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => node.reset()}
              onKeyDown={(e) => {
                if (e.key === "Escape") node.reset();
                if (e.key === "Enter") node.submit(e.currentTarget.value);
              }}
            />
          ) : (
            <span className={cn("flex-1 truncate", st && statusClass(st), st === "D" && "line-through")}>{d.name}</span>
          )}
          {st && <span className={cn("ml-1 w-3 text-right font-mono text-[10px] font-semibold", statusClass(st))}>{st === "?" ? "U" : st}</span>}
          {dirChanged && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-warning/80" aria-label="包含改动" />}
        </div>
      );
    };
    return Comp;
  }, [git, activeId]);

  if (!cwd) {
    return <div className="p-4 text-xs text-muted-foreground">先在左侧选择一个工作区，或用“文件 → 打开文件夹”。</div>;
  }
  const rootName = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;

  return (
    <div className="flex h-full flex-col" onClick={() => setMenu(null)}>
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" title={cwd}>{rootName}</span>
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <button className="rounded p-1 hover:bg-accent hover:text-foreground" title="新建文件" onClick={() => void createIn("", "file")}><FilePlus2 className="h-3.5 w-3.5" /></button>
          <button className="rounded p-1 hover:bg-accent hover:text-foreground" title="新建文件夹" onClick={() => void createIn("", "dir")}><FolderPlus className="h-3.5 w-3.5" /></button>
          <button className="rounded p-1 hover:bg-accent hover:text-foreground" title="刷新" onClick={() => { void loadDir(""); void refreshGit(); }}><RefreshCw className="h-3.5 w-3.5" /></button>
          <button className="rounded p-1 hover:bg-accent hover:text-foreground" title="全部折叠" onClick={() => treeRef.current?.closeAll()}><ChevronsDownUp className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div
        ref={boxRef}
        className="flex-1 min-h-0 py-1"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, node: null });
        }}
      >
        {error ? (
          <div className="p-3 text-xs text-destructive">{error}</div>
        ) : (
          <Tree<TreeNode>
            ref={treeRef}
            data={data}
            width={size.w}
            height={size.h}
            rowHeight={24}
            indent={12}
            overscanCount={8}
            openByDefault={false}
            disableMultiSelection
            aria-label="工作区文件"
            className="acp-tree"
            rowClassName="outline-none focus:outline-none focus-visible:outline-none"
            onToggle={onToggle}
            disableDrop={({ parentNode }) => !!parentNode && parentNode.data?.type !== "dir" && !parentNode.isRoot}
            onActivate={(n: NodeApi<TreeNode>) => {
              if (n.data.type === "file") void openFile(cwd, n.id, { pin: false });
            }}
            onRename={({ id, name }) => guard(async () => {
              if (!name || name.includes("/") || name.includes("\\")) throw new Error("名称无效");
              const to = parentOf(id) ? `${parentOf(id)}/${name}` : name;
              if (to === id) return;
              await fsRename(cwd, id, to);
              await loadDir(parentOf(id));
            }, "重命名")}
            onMove={({ dragIds, parentId }) => guard(async () => {
              const dest = parentId || "";
              for (const id of dragIds) {
                const name = id.split("/").pop()!;
                const to = dest ? `${dest}/${name}` : name;
                if (to !== id && !dest.startsWith(id + "/")) await fsRename(cwd, id, to);
                await loadDir(parentOf(id));
              }
              await loadDir(dest);
            }, "移动")}
          >
            {Node}
          </Tree>
        )}
      </div>
      {menu && (
        <div
          className="fixed z-[95] min-w-48 rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-lg"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 280) }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxItems(menu.node).map((it, i) =>
            it === "sep" ? (
              <div key={i} className="my-1 h-px bg-border" />
            ) : (
              <button
                key={i}
                className={cn("flex w-full items-center rounded-sm px-2 py-1.5 text-left hover:bg-accent", it.danger && "text-destructive")}
                onClick={() => { setMenu(null); it.run(); }}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
};

export default FileTreePanel;
