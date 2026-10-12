/** 最近打开的文件夹（主进程持久化到 userData/recent-folders.json，最多 10 个）。 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export const RECENT_MAX = 10;
const file = () => path.join(app.getPath("userData"), "recent-folders.json");

export function pushRecent(list: string[], p: string, max = RECENT_MAX): string[] {
  const norm = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
  return [p, ...list.filter((x) => norm(x) !== norm(p))].slice(0, max);
}

export function loadRecent(): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(file(), "utf8"));
    return Array.isArray(data) ? data.filter((x) => typeof x === "string" && fs.existsSync(x)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function addRecent(p: string): string[] {
  const next = pushRecent(loadRecent(), p);
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(next));
  } catch {}
  try {
    app.addRecentDocument(p);
  } catch {}
  return next;
}

export function clearRecent() {
  try {
    fs.writeFileSync(file(), "[]");
  } catch {}
  try {
    app.clearRecentDocuments();
  } catch {}
}
