/**
 * 输入框拖放 / 粘贴的纯逻辑（可单测）：
 * - 文件树拖拽用自定义 MIME 传工作区相对路径；
 * - 系统拖入的文件若在当前工作区内 → 变成 @ 引用；工作区外 → 普通附件（有大小上限）；
 * - 文件夹引用最多展开 FOLDER_FILE_CAP 个文件。
 */
export const ACP_PATH_MIME = "application/x-acp-path";
export const FOLDER_FILE_CAP = 20;
export const OUTSIDE_TEXT_MAX = 512 * 1024;
export const OUTSIDE_FILE_MAX = 10 * 1024 * 1024;

export interface DragRef {
  path: string;
  kind: "file" | "dir";
}

let activeDragRefs: DragRef[] | null = null;

export function setActiveDragRefs(refs: DragRef[] | null) {
  activeDragRefs = refs;
}

export function getActiveDragRefs(): DragRef[] | null {
  return activeDragRefs;
}

export function encodeDragRefs(refs: DragRef[]): string {
  return JSON.stringify(refs);
}
export function decodeDragRefs(raw: string | null | undefined): DragRef[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((r) => r && typeof r.path === "string" && (r.kind === "file" || r.kind === "dir") && !r.path.includes("..")).map((r) => ({ path: r.path, kind: r.kind }))
      : [];
  } catch {
    return [];
  }
}

/** 绝对路径 → 工作区相对路径（"/" 分隔）；不在工作区内返回 null。Windows 路径大小写不敏感。 */
export function relativeToWorkspace(cwd: string, abs: string): string | null {
  if (!cwd || !abs) return null;
  const win = /^[a-zA-Z]:[\\/]/.test(cwd) || cwd.includes("\\");
  const norm = (p: string) => {
    let s = p.replace(/\\/g, "/").replace(/\/+$/, "");
    if (win) s = s.toLowerCase();
    return s;
  };
  const root = norm(cwd);
  const target = norm(abs);
  if (target === root) return "";
  if (!target.startsWith(root + "/")) return null;
  const rel = abs.replace(/\\/g, "/").slice(cwd.replace(/\\/g, "/").replace(/\/+$/, "").length + 1);
  return rel.split("/").some((s) => s === "..") ? null : rel;
}

export type OutsideKind = "image" | "text" | "link" | "reject-image" | "reject-size";

/** 工作区外文件的处理方式。 */
export function classifyOutsideFile(f: { type: string; size: number }, supportImage: boolean): OutsideKind {
  if (f.type.startsWith("image/")) return supportImage ? (f.size > OUTSIDE_FILE_MAX ? "reject-size" : "image") : "reject-image";
  if (f.size > OUTSIDE_FILE_MAX) return "reject-size";
  const textish = /^(text\/|application\/(json|javascript|typescript|xml)|.*\+(json|xml)$)/.test(f.type) || f.type === "";
  if (textish && f.size <= OUTSIDE_TEXT_MAX) return "text";
  return "link";
}

/** 广度优先收集文件夹下的文件（跳过 node_modules/.git 由后端负责），最多 cap 个。 */
export async function collectFolderFiles(
  dir: string,
  list: (dir: string) => Promise<Array<{ path: string; type: string }>>,
  cap = FOLDER_FILE_CAP,
  maxDirs = 50,
): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const queue = [dir];
  let visited = 0;
  while (queue.length && visited < maxDirs) {
    const d = queue.shift()!;
    visited++;
    for (const e of await list(d)) {
      if (e.type === "file") {
        if (files.length >= cap) return { files, truncated: true };
        files.push(e.path);
      } else if (e.type === "dir") queue.push(e.path);
    }
  }
  return { files, truncated: queue.length > 0 };
}

/** 删除引用标签时，把文本里对应的 "@路径" 一并去掉。 */
export function stripMentionText(text: string, path: string): string {
  const esc = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(^|\\s)@${esc}/?(?=\\s|$)\\s?`, "g"), "$1");
}
