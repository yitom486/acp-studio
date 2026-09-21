import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleUniversal } from "../../server/universal/routes";

function req(urlPath: string): Request {
  return new Request(`http://localhost${urlPath}`, { method: "GET" });
}

describe("git inspection routes", () => {
  let repo = "";
  let hasGit = true;

  beforeAll(() => {
    const probe = spawnSync("git", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) {
      hasGit = false;
      return;
    }
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "acp-git-"));
    const run = (args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    run(["init"]);
    run(["config", "user.email", "t@t.t"]);
    run(["config", "user.name", "t"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
    run(["add", "."]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "one\nTWO\n");
    fs.writeFileSync(path.join(repo, "new.txt"), "hello\n");
  });

  afterAll(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
  });

  it("status lists modified + untracked files with branch", async () => {
    if (!hasGit || !repo) return;
    const res = (await handleUniversal(req(`/api/universal/git/status?cwd=${encodeURIComponent(repo)}`)))!;
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.files.map((f: any) => f.path).sort()).toEqual(["a.txt", "new.txt"]);
    expect(typeof data.branch).toBe("string");
  });

  it("file returns before/after plus unified diff", async () => {
    if (!hasGit || !repo) return;
    const res = (await handleUniversal(req(`/api/universal/git/file?cwd=${encodeURIComponent(repo)}&file=a.txt`)))!;
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.binary).toBe(false);
    expect(data.before).toContain("two");
    expect(data.after).toContain("TWO");
    expect(data.unified).toContain("-two");
    expect(data.unified).toContain("+TWO");
  });

  it("rejects non-repos and path escapes", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-nogit-"));
    try {
      const bad = (await handleUniversal(req(`/api/universal/git/status?cwd=${encodeURIComponent(tmp)}`)))!;
      expect(bad.status).toBe(400);
      const esc = (await handleUniversal(
        req(`/api/universal/git/file?cwd=${encodeURIComponent(tmp)}&file=../../x`)
      ))!;
      expect([400, 500].includes(esc.status) || !(await esc.json()).ok).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
