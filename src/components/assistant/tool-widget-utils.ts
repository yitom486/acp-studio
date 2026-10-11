/**
 * Pure data helpers and registry for ACP tool calls.
 * Kept strictly in this non-component module so React Fast Refresh (HMR)
 * in AcpToolWidgets.tsx remains fully active without invalidation warnings.
 */

export interface WidgetTool {
  id: string;
  title: string;
  kind?: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt?: number;
  completedAt?: number;
  name?: string;
  rawInput?: unknown;
  locations?: Array<{ path: string; line?: number }>;
  rawOutput?: unknown;
  rawError?: unknown;
}

export type WidgetKey = "terminal" | "file-read" | "file-edit" | "search";

/** Human-readable text out of unknown tool payloads, capped. */
export function toolText(v: unknown, cap = 4000): string {
  let s = "";
  if (typeof v === "string") s = v;
  else if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") s = String(v);
  else if (v == null) return "";
  else {
    try {
      s = JSON.stringify(v, null, 1);
    } catch {
      return "";
    }
  }
  return s.length > cap ? s.slice(0, cap) + "\n…[truncated]" : s;
}

export function firstLines(text: string, n: number): { shown: string; total: number } {
  const all = text.split("\n");
  return { shown: all.slice(0, n).join("\n"), total: all.length };
}

export function lastLines(text: string, n: number): { shown: string; total: number } {
  const all = text.split("\n");
  return { shown: all.slice(-n).join("\n"), total: all.length };
}

export function extractFileFromTool(title: string): string | null {
  if (!title) return null;
  const match = title.match(/([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]{1,10})/);
  if (match) {
    const candidate = match[1];
    if (
      candidate.includes("/") ||
      candidate.includes("\\") ||
      /\.(tsx?|jsx?|json|md|css|html|rs|py|go|cs)$/i.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

export function strField(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/** Best-effort file path: locations -> params -> title. */
export function toolPath(tc: Pick<WidgetTool, "title" | "locations" | "rawInput">): string | null {
  const loc = tc.locations?.find((l) => l && typeof l.path === "string" && l.path);
  if (loc) return loc.path;
  const fromParams = strField(tc.rawInput, ["path", "file", "filePath", "filename", "pattern", "dir", "directory"]);
  if (fromParams) return fromParams;
  return extractFileFromTool(tc.title);
}

/** Best-effort command line: params -> title. */
export function toolCommand(tc: Pick<WidgetTool, "title" | "rawInput">): string {
  const cmd = strField(tc.rawInput, ["CommandLine", "command", "cmd", "script", "code"]);
  if (cmd) {
    const oneLine = cmd.trim().replace(/\s+/g, " ");
    return oneLine.length > 200 ? oneLine.slice(0, 199) + "…" : oneLine;
  }
  return tc.title;
}

/** Heuristic: at least 2 +/- content lines => looks like a diff. */
export function isDiffText(t: string): boolean {
  let hits = 0;
  for (const line of t.split("\n")) {
    if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) {
      if (++hits >= 2) return true;
    }
  }
  return false;
}

/** kind -> name -> title, conservative; unknown => null (generic row). */
export function resolveWidgetKey(tc: Pick<WidgetTool, "title" | "kind" | "name">): WidgetKey | null {
  const kind = (tc.kind || "").toLowerCase();
  if (kind === "execute" || kind === "terminal") return "terminal";
  if (kind === "edit" || kind === "diff") return "file-edit";
  if (kind === "read" || kind === "file") return "file-read";
  if (kind === "search") return "search";

  const name = (tc.name || "").toLowerCase();
  if (
    /^(run_|exec|terminal|shell|bash|sh_|powershell)/.test(name) ||
    /^(runcommand|executecommand|bash|powershell|cmd|sh)$/.test(name) ||
    name.includes("command")
  ) return "terminal";

  if (
    /^(write_|replace_|multi_|sed|edit|apply_|patch)/.test(name) ||
    /^(writefile|editfile|write|edit|patch)$/.test(name)
  ) return "file-edit";

  if (
    /^(read_|view_|cat|list_|show_|fetch_)/.test(name) ||
    /^(readfile|viewfile|listfiles|listdir|read|view|cat|list|glob|dir|ls)$/.test(name)
  ) return "file-read";

  if (
    /^(find_|grep|search)/.test(name) ||
    /search|grep/.test(name) ||
    /^(searchfiles|findfiles|find|grep)$/.test(name)
  ) return "search";

  const title = tc.title || "";
  if (/^(run|exec|npm|bun|yarn|node|python|git|docker|ls|cd|mkdir|rm|echo|chmod|cargo|go|cat)\s/i.test(title)) {
    return /^(cat|ls)\s/i.test(title) ? "file-read" : "terminal";
  }
  if (/^(read|view|show|list)\s/i.test(title)) return "file-read";
  return null;
}

/** Detects opaque machine-generated tool call IDs (e.g. call_01a..., tc-123..., hex/uuid hashes). */
export function isRawToolCallId(str?: string | null): boolean {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  if (!s) return false;
  if (/^call_[a-zA-Z0-9_-]+$/i.test(s)) return true;
  if (/^tc-\d+-[a-z0-9]+$/i.test(s)) return true;
  if (/^tool-\d+.*$/i.test(s)) return true;
  if (/^[0-9a-f]{20,64}$/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  if (s === "Tool call" || s === "tool_call" || s === "工具调用") return true;
  return false;
}

/** Human-friendly action verb or category from tool name/kind. */
export function friendlyToolActionName(name?: string, kind?: string): string {
  const n = (name || "").toLowerCase().trim();
  const k = (kind || "").toLowerCase().trim();

  // File Read / Browse
  if (/^(read_file|readfile|view_file|viewfile|cat|read|view)$/i.test(n) || k === "read" || k === "file") {
    return "读取文件";
  }
  if (/^(list_files|listfiles|list_dir|listdir|glob|dir|ls|list)$/i.test(n)) {
    return "浏览目录";
  }

  // File Write / Edit
  if (/^(write_file|writefile|write|create_file|createfile)$/i.test(n)) {
    return "新建文件";
  }
  if (/^(edit_file|editfile|edit|replace_file_content|multi_replace_file_content|patch|apply_diff)$/i.test(n) || k === "edit" || k === "diff") {
    return "编辑文件";
  }

  // Search
  if (/^(grep_search|grep|search_files|searchfiles|find_files|findfiles|search|find)$/i.test(n) || k === "search") {
    return "搜索代码";
  }

  // Terminal / Execute
  if (/^(run_command|runcommand|execute_command|executecommand|bash|sh|powershell|cmd|terminal|exec|execute)$/i.test(n) || k === "execute" || k === "terminal") {
    return "执行命令";
  }

  if (name && name.trim()) {
    return name.trim();
  }
  return "工具调用";
}

/**
 * Resolves a human-friendly display title for a tool call.
 * If tc.title is already informative and not a raw hash/ID, it is returned directly.
 * Otherwise, synthesizes a title using name, filePath, command, or search query.
 */
export function resolveToolDisplayTitle(
  tc: Pick<WidgetTool, "id" | "title"> & Partial<Pick<WidgetTool, "name" | "kind" | "rawInput" | "locations">>
): string {
  const currentTitle = (tc.title || "").trim();
  if (currentTitle && !isRawToolCallId(currentTitle)) {
    return currentTitle;
  }

  const action = friendlyToolActionName(tc.name, tc.kind);
  const path = toolPath(tc);
  if (path) {
    return `${action}: ${path}`;
  }

  const cmd = strField(tc.rawInput, ["CommandLine", "command", "cmd", "script", "code"]);
  if (cmd) {
    const oneLine = cmd.trim().replace(/\s+/g, " ");
    const preview = oneLine.length > 80 ? oneLine.slice(0, 77) + "…" : oneLine;
    return `${action}: ${preview}`;
  }

  const query = strField(tc.rawInput, ["pattern", "query", "search", "keyword"]);
  if (query) {
    const qPreview = query.length > 50 ? query.slice(0, 47) + "…" : query;
    return `${action}: "${qPreview}"`;
  }

  if (tc.name && tc.name.trim()) {
    const friendly = friendlyToolActionName(tc.name, tc.kind);
    return friendly !== tc.name ? `${friendly} (${tc.name})` : tc.name;
  }

  if (tc.id) {
    const shortId = tc.id.length > 16 ? `${tc.id.slice(0, 8)}…` : tc.id;
    return `工具调用 (${shortId})`;
  }

  return "工具调用";
}

/** 真实耗时格式化（客户端 wall-clock 打点，无数据时不渲染）。 */
export function fmtElapsed(ms: number): string {
  if (ms < 0) return "";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}分${String(s).padStart(2, "0")}s`;
}

