/**
 * 从 CHANGELOG.md 截取某个版本的小节，作为 GitHub Release 说明。
 *   bun scripts/release-notes.ts 0.1.1 [--out notes.md]
 * 版本缺省取 package.json；找不到对应小节时退出码 1（发版应失败，而不是发空说明）。
 */
import * as fs from "node:fs";
import * as path from "node:path";

export function extractSection(changelog: string, version: string): string | null {
  const v = version.replace(/^v/, "");
  const lines = changelog.split(/\r?\n/);
  const head = new RegExp(`^## \\[${v.replace(/\./g, "\\.")}\\]`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^## /.test(l) || /^\[[^\]]+\]:\s/.test(l)) break;
    if (/^\s*<!--.*-->\s*$/.test(l)) continue;
    body.push(l);
  }
  const text = body.join("\n").trim();
  return text ? text + "\n" : null;
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..");
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const version =
    args.find((a, i) => !a.startsWith("--") && i !== outIdx + 1) ||
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const notes = extractSection(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), version);
  if (!notes) {
    console.error(`CHANGELOG.md 里没有找到 [${version}] 小节或内容为空`);
    process.exit(1);
  }
  if (out) fs.writeFileSync(out, notes);
  else process.stdout.write(notes);
}
