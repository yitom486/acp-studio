/**
 * 工作台 UI 状态：侧栏 / 文件树 / 设置 / 命令面板开关，以及编辑器标签页。
 * 标签页语义同 VS Code：单击文件 = 预览标签（斜体，下一次预览会替换它），
 * 双击或开始编辑 = 固定。dirty = text !== savedText。
 */
import { create } from "zustand";

export interface EditorTab {
  /** 唯一键：文件是相对路径，diff 视图是 "diff:" + 路径 */
  id: string;
  path: string;
  kind: "file" | "diff";
  text: string;
  savedText: string;
  mtimeMs: number | null;
  preview: boolean;
  loading?: boolean;
  error?: string;
  /** 磁盘上的新内容（外部 / AI 修改了，但本地有未保存改动）→ 冲突条 */
  conflict?: { text: string; mtimeMs: number } | null;
  /** AI / 外部修改后自动重载时，新增或修改的行（1-based），短暂高亮 */
  flashLines?: number[];
  flashAt?: number;
  /** 视图：源码（默认）/ Markdown 所见即所得 / 笔记本预览（.ipynb 默认） */
  view?: "source" | "wysiwyg" | "notebook";
}

export type SettingsTab = "general" | "gateway" | "about";

interface WorkbenchState {
  sidebarOpen: boolean;
  fileTreeOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  paletteOpen: boolean;
  paletteQuery: string;
  tabs: EditorTab[];
  activeId: string | null;
  setSidebarOpen: (v: boolean) => void;
  setFileTreeOpen: (v: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setPaletteOpen: (v: boolean, query?: string) => void;
  openTab: (tab: Omit<EditorTab, "preview"> & { preview?: boolean }) => void;
  patchTab: (id: string, patch: Partial<EditorTab>) => void;
  pinTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  setActive: (id: string) => void;
}

const PREFS_KEY = "acp_workbench_prefs_v1";
function loadPrefs(): { sidebarOpen: boolean; fileTreeOpen: boolean } {
  try {
    const d = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { sidebarOpen: d.sidebarOpen !== false, fileTreeOpen: d.fileTreeOpen === true };
  } catch {
    return { sidebarOpen: true, fileTreeOpen: false };
  }
}
function savePrefs(p: { sidebarOpen: boolean; fileTreeOpen: boolean }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}

export const isDirty = (t: EditorTab) => t.kind === "file" && !t.loading && t.text !== t.savedText;

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  ...loadPrefs(),
  settingsOpen: false,
  settingsTab: "general",
  paletteOpen: false,
  paletteQuery: "",
  tabs: [],
  activeId: null,
  setSidebarOpen: (v) => {
    set({ sidebarOpen: v });
    savePrefs({ sidebarOpen: v, fileTreeOpen: get().fileTreeOpen });
  },
  setFileTreeOpen: (v) => {
    set({ fileTreeOpen: v });
    savePrefs({ sidebarOpen: get().sidebarOpen, fileTreeOpen: v });
  },
  openSettings: (tab = "general") => set({ settingsOpen: true, settingsTab: tab }),
  closeSettings: () => set({ settingsOpen: false }),
  setPaletteOpen: (v, query = "") => set({ paletteOpen: v, paletteQuery: query }),
  openTab: (tab) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.id === tab.id);
      if (existing) {
        const tabs = tab.preview === false ? s.tabs.map((t) => (t.id === tab.id ? { ...t, preview: false } : t)) : s.tabs;
        return { tabs, activeId: tab.id };
      }
      const preview = tab.preview !== false;
      let tabs = s.tabs;
      // 新的预览标签替换旧的（未改动的）预览标签
      if (preview) {
        const old = tabs.find((t) => t.preview && !isDirty(t));
        if (old) tabs = tabs.map((t) => (t.id === old.id ? { ...tab, preview } : t));
        else tabs = [...tabs, { ...tab, preview }];
      } else tabs = [...tabs, { ...tab, preview }];
      return { tabs, activeId: tab.id };
    }),
  patchTab: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  pinTab: (id) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, preview: false } : t)) })),
  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId = s.activeId === id ? (tabs[idx] || tabs[idx - 1] || null)?.id ?? null : s.activeId;
      return { tabs, activeId };
    }),
  closeOthers: (id) => set((s) => ({ tabs: s.tabs.filter((t) => t.id === id || isDirty(t)), activeId: id })),
  closeAll: () => set((s) => ({ tabs: s.tabs.filter(isDirty), activeId: s.tabs.filter(isDirty)[0]?.id ?? null })),
  setActive: (id) => set({ activeId: id }),
}));
