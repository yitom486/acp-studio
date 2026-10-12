/**
 * /api/universal/git/* — workspace git inspection for the "view code changes" UI.
 * Same trust level as the fs/terminal client capabilities (local dev tool).
 * Guards: cwd must exist + be a git repo; file must stay inside cwd;
 * outputs are byte-capped.
 */
import { Hono, type Context } from "hono";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { json, jsonBody, optStr, type BodyEnv } from "./shared";

const GIT_MAX_BYTES = 300_000;

function runGit(cwd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: GIT_MAX_BYTES * 2,
      windowsHide: true,
    });
    if (r.error) return { ok: false, out: String(r.error.message || r.error) };
    const out = typeof r.stdout === "string" ? r.stdout : "";
    return { ok: r.status === 0, out: out.slice(0, GIT_MAX_BYTES) };
  } catch (err) {
    return { ok: false, out: (err as Error).message };
  }
}

function resolveRepo(cwd: string): { repo?: string; error?: string } {
  if (!cwd || !fs.existsSync(cwd)) return { error: "cwd 不存在" };
  const top = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.out.trim()) return { error: "该目录不是 git 仓库" };
  // Normalize Windows separators for reliable prefix checks.
  return { repo: path.normalize(top.out.trim()) };
}

export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
}

function parsePorcelain(out: string): GitFileChange[] {
  const changes: GitFileChange[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    // Format: XY SP path (rename: "old" -> "new")
    const x = line[0] || " ";
    const y = line[1] || " ";
    let p = line.slice(3).trim();
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4).trim();
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
      p = p.slice(1, -1);
    }
    const staged = x !== " " && x !== "?";
    const status = x === "?" ? "?" : (x !== " " ? x : y);
    changes.push({ path: p, status, staged });
  }
  return changes.slice(0, 500);
}

/** Resolve `file` inside `repo`; null when it escapes the repo. */
function repoRelative(repo: string, file: string): { abs: string; rel: string } | null {
  const abs = path.normalize(path.join(repo, file));
  if (!file || (abs !== repo && !abs.startsWith(repo + path.sep))) return null;
  return { abs, rel: path.relative(repo, abs) };
}

const fileOpBody = z.looseObject({ cwd: optStr, file: optStr });

/** POST stage/restore share the same shape: {cwd, file} → git <args> -- <rel>. */
function fileOp(gitArgs: string[], label: string) {
  return async (c: Context<BodyEnv<z.infer<typeof fileOpBody>>>) => {
    try {
      const body = c.get("body");
      const resolved = resolveRepo(String(body.cwd || ""));
      if (!resolved.repo) return json({ ok: false, error: resolved.error }, 400);
      const target = repoRelative(resolved.repo, String(body.file || ""));
      if (!target) return json({ ok: false, error: "file 必须位于仓库内" }, 400);
      const res = runGit(resolved.repo, [...gitArgs, "--", target.rel]);
      if (!res.ok) return json({ ok: false, error: res.out || `${label} 失败` }, 500);
      return json({ ok: true });
    } catch (err: any) {
      return json({ ok: false, error: err.message || `${label} 失败` }, 400);
    }
  };
}

export const gitRouter = new Hono();

gitRouter.post("/stage", jsonBody(fileOpBody), fileOp(["add"], "git add"));
gitRouter.post("/restore", jsonBody(fileOpBody), fileOp(["restore"], "git restore"));

gitRouter.get("/status", (c) => {
  const resolved = resolveRepo(c.req.query("cwd") || "");
  if (!resolved.repo) return json({ ok: false, error: resolved.error }, 400);
  const repo = resolved.repo;
  const branch = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = runGit(repo, ["status", "--porcelain=v1", "-uall"]);
  if (!porcelain.ok) return json({ ok: false, error: porcelain.out.slice(0, 300) || "git status 失败" }, 500);
  return json({
    ok: true,
    repo,
    branch: branch.ok ? branch.out.trim() : "",
    files: parsePorcelain(porcelain.out),
  });
});

// GET /file?cwd=&file= : before (HEAD) + after (worktree) texts.
gitRouter.get("/file", (c) => {
  const resolved = resolveRepo(c.req.query("cwd") || "");
  if (!resolved.repo) return json({ ok: false, error: resolved.error }, 400);
  const repo = resolved.repo;
  const target = repoRelative(repo, c.req.query("file") || "");
  if (!target) return json({ ok: false, error: "file 必须位于仓库内" }, 400);
  const { abs, rel } = target;
  const numstat = runGit(repo, ["diff", "--numstat", "--", rel]);
  const binary = numstat.ok && numstat.out.split("\n").some((l) => l.startsWith("-\t-\t"));
  let before: string | null = null;
  let after: string | null = null;
  let unified: string | null = null;
  if (!binary) {
    const show = runGit(repo, ["show", `HEAD:${rel}`]);
    if (show.ok) before = show.out.slice(0, GIT_MAX_BYTES);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const buf = fs.readFileSync(abs);
        if (!buf.includes(0)) after = buf.toString("utf8").slice(0, GIT_MAX_BYTES);
      }
    } catch (err) {
      // Deleted / unreadable worktree file: the diff view shows "no after" (same as a deletion).
      console.warn(`[Universal] git/file worktree read failed ${abs}: ${(err as Error).message}`);
      after = null;
    }
    const diff = runGit(repo, ["diff", "HEAD", "--no-color", "-U3", "--", rel]);
    if (diff.ok && diff.out.trim()) unified = diff.out.slice(0, GIT_MAX_BYTES);
  }
  return json({
    ok: true,
    repo,
    file: rel,
    binary,
    truncated: (before?.length || 0) >= GIT_MAX_BYTES || (after?.length || 0) >= GIT_MAX_BYTES,
    before,
    after,
    unified,
  });
});

// Read-only endpoints: any other method is a 405 (not a generic 404).
gitRouter.all("/status", () => json({ ok: false, error: "method not allowed" }, 405));
gitRouter.all("/file", () => json({ ok: false, error: "method not allowed" }, 405));
