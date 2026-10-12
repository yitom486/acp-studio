/**
 * /api/universal/workspace/* — default workspace, folder validation (adding a
 * workspace in the UI) and the read-only file browser used by @-mentions.
 */
import { Hono, type Context } from "hono";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { dangerousRootReason } from "../security";
import { json, jsonBody, optStr } from "./shared";

export const workspaceRouter = new Hono();

/**
 * `wsl -l -q`（UTF-16 解码后）→ 发行版名（纯函数，可测）。
 * 兼容默认发行版的 `*` / ` (Default)` 后缀；无发行版时 wsl 吐的是帮助文本
 *（含 URL/冒号/Microsoft Store 行），一并过滤，绝不把它们当发行版。
 * 跳过标题行，去重保序。
 */
export function parseWslDistros(raw: string): string[] {
  const out: string[] = [];
  for (let line of String(raw || "").split("\n")) {
    line = line
      .replace(/\0/g, "")
      .replace(/\r/g, "")
      .trim()
      .replace(/\*$/, "")
      .replace(/\s*\(Default\)$/i, "")
      .trim();
    if (!line) continue;
    if (/windows subsystem for linux/i.test(line)) continue;
    if (/^https?:\/\//i.test(line) || /microsoft store/i.test(line)) continue;
    if (/^distributions can be/i.test(line) || /:$/.test(line)) continue;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

workspaceRouter.get("/wsl-distros", () => {
  if (process.platform !== "win32") return json({ ok: true, distros: [] as string[] });
  try {
    // 注意：wsl.exe 列表输出是 UTF-16，必须 utf16le 解码，否则全是 \0 间隔的乱码。
    const r = spawnSync("wsl.exe", ["-l", "-q"], {
      encoding: "utf16le",
      timeout: 10000,
      windowsHide: true,
    });
    if (r.error) {
      const msg = String((r.error as any)?.message || r.error);
      // ENOENT = 本机没装 WSL：给安装指引，不报含糊的“不可用”
      if (/ENOENT/i.test(msg)) {
        return json(
          { ok: false, error: "本机未安装 WSL：请在管理员 PowerShell 跑 wsl --install，装好发行版后重启网关" },
          500
        );
      }
      return json({ ok: false, error: `wsl 调用失败：${msg}` }, 500);
    }
    const distros = parseWslDistros(typeof r.stdout === "string" ? r.stdout : "");
    return json({ ok: true, distros });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message || "获取 WSL 发行版失败" }, 500);
  }
});

workspaceRouter.get("/default", () => {
  const cwd = process.cwd();
  return json({ ok: true, path: cwd, name: path.basename(cwd) });
});

const validateBody = z.looseObject({ path: optStr });

workspaceRouter.post("/validate", jsonBody(validateBody), (c) => {
  try {
    const target = String(c.get("body").path || "").trim();
    if (!target) return json({ ok: false, error: "路径不能为空" }, 400);
    const resolved = path.resolve(target);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return json({ ok: false, error: "指定的路径不存在或不是有效目录" }, 400);
    }
    // 用户在 UI 里选的工作区 = 会话 cwd = 智能体允许写入的根（见
    // AgentConnection.sessionRoots）。这里只拦“选了等于放开整台机器”的根。
    const bad = dangerousRootReason(resolved);
    if (bad) return json({ ok: false, error: bad }, 403);
    const isGit = fs.existsSync(path.join(resolved, ".git"));
    return json({ ok: true, path: resolved, name: path.basename(resolved), isGit });
  } catch (err: any) {
    console.error(`[Universal] workspace validate failed: ${err.message || err}`);
    return json({ ok: false, error: err.message || "校验工作区失败" }, 400);
  }
});

/**
 * Workspace file browser for @-mentions (read-only).
 * Same trust level as the git inspection endpoints: cwd must exist+be a
 * directory, everything stays confined to cwd, outputs are capped.
 * - GET /files?cwd=&q=&limit= : recursive list
 * - GET /read?cwd=&file= : capped text read
 */
const WS_FILE_IGNORES = new Set([
  "node_modules", ".git", "dist", "release", "release-local", "release-node",
  "electron-dist", ".next", "out", "build", "target", "coverage", ".venv",
  "venv", "__pycache__", ".turbo", ".cache",
]);
const WS_FILES_LIMIT = 200;
const WS_WALK_DEPTH = 6;
const WS_READ_MAX = 65536;

function walkWorkspaceFiles(root: string, q: string, limit: number): { files: Array<{ path: string; size: number; mtimeMs: number }>; truncated: boolean } {
  const out: Array<{ path: string; size: number; mtimeMs: number }> = [];
  const needle = q.trim().toLowerCase();
  let truncated = false;
  const visit = (dir: string, depth: number): void => {
    if (out.length >= limit) {
      truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // unreadable subdirectory (permissions): skip it, the rest of the tree is still listable
      return;
    }
    entries.sort((a, b) =>
      a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1
    );
    for (const e of entries) {
      if (out.length >= limit) {
        truncated = true;
        return;
      }
      if (WS_FILE_IGNORES.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < WS_WALK_DEPTH) visit(abs, depth + 1);
      } else if (e.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        if (!needle || rel.toLowerCase().includes(needle)) {
          let size = 0;
          let mtimeMs = 0;
          try {
            const st = fs.statSync(abs);
            size = st.size;
            mtimeMs = Math.round(st.mtimeMs);
          } catch {
            // unreadable stat: still listable, size unknown
          }
          out.push({ path: rel, size, mtimeMs });
        }
      }
      // symlinks and others are skipped (no escape via link)
    }
  };
  visit(root, 0);
  return { files: out, truncated };
}

function workspaceTextMime(rel: string): string {
  const ext = rel.split(".").pop()?.toLowerCase() || "";
  if (ext === "json") return "application/json";
  if (["md", "markdown", "txt", "log", "csv", "tsv", "xml", "yml", "yaml", "html", "css", "toml", "ini", "cfg", "sh", "ps1"].includes(ext)) return `text/${ext === "yml" ? "yaml" : ext === "markdown" ? "markdown" : "plain"}`;
  return "text/plain";
}

/** cwd query param must be an existing directory; returns the resolved path or an error Response. */
function workspaceCwd(c: Context): string | Response {
  const rawCwd = c.req.query("cwd") || "";
  const cwd = path.resolve(rawCwd);
  try {
    if (!rawCwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      return json({ ok: false, error: "cwd 不存在或不是有效目录" }, 400);
    }
  } catch (err: any) {
    return json({ ok: false, error: err.message || "cwd 校验失败" }, 400);
  }
  return cwd;
}

workspaceRouter.get("/files", (c) => {
  const cwd = workspaceCwd(c);
  if (cwd instanceof Response) return cwd;
  const q = (c.req.query("q") || "").slice(0, 200);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "", 10) || 50, 1), WS_FILES_LIMIT);
  const { files, truncated } = walkWorkspaceFiles(cwd, q, limit);
  return json({ ok: true, repo: cwd, files, truncated });
});

workspaceRouter.get("/read", (c) => {
  const cwd = workspaceCwd(c);
  if (cwd instanceof Response) return cwd;
  const file = c.req.query("file") || "";
  const abs = path.normalize(path.join(cwd, file));
  if (!file || (abs !== cwd && !abs.startsWith(cwd + path.sep))) {
    return json({ ok: false, error: "file 必须位于工作区内" }, 400);
  }
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return json({ ok: false, error: "文件不存在" }, 404);
    }
    const rel = path.relative(cwd, abs).split(path.sep).join("/");
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) {
      return json({ ok: false, error: "二进制文件不支持作为附件引用（请用文件选择器）" }, 415);
    }
    const text = buf.toString("utf8");
    const truncated = text.length > WS_READ_MAX;
    const st = fs.statSync(abs);
    return json({
      ok: true,
      repo: cwd,
      file: rel,
      mimeType: workspaceTextMime(rel),
      size: st.size,
      text: truncated ? text.slice(0, WS_READ_MAX) : text,
      truncated,
    });
  } catch (err: any) {
    return json({ ok: false, error: err.message || "读取文件失败" }, 400);
  }
});
