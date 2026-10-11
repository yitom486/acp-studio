import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleUniversal } from "../../server/universal/routes";

function makeTree(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-wsfiles-"));
  fs.writeFileSync(path.join(tmp, "a.ts"), "export const a = 1;\n");
  fs.mkdirSync(path.join(tmp, "sub"));
  fs.writeFileSync(path.join(tmp, "sub", "b.md"), "# B\n");
  fs.mkdirSync(path.join(tmp, "node_modules"));
  fs.writeFileSync(path.join(tmp, "node_modules", "x.js"), "evil();\n");
  fs.mkdirSync(path.join(tmp, ".git"));
  fs.writeFileSync(path.join(tmp, ".git", "HEAD"), "ref\n");
  return tmp;
}

async function getJson(url: string) {
  const res = (await handleUniversal(new Request(url, { method: "GET" })))!;
  return { status: res.status, data: await res.json() };
}

describe("workspace files/read routes (@-mentions)", () => {
  it("lists files, filters by query, and skips ignored dirs", async () => {
    const tmp = makeTree();
    try {
      const all = await getJson(
        `http://localhost/api/universal/workspace/files?cwd=${encodeURIComponent(tmp)}`
      );
      expect(all.data.ok).toBe(true);
      const paths = (all.data.files as Array<{ path: string }>).map((f) => f.path);
      expect(paths).toContain("a.ts");
      expect(paths).toContain("sub/b.md");
      expect(paths.some((x) => x.includes("node_modules") || x.includes(".git"))).toBe(false);

      const filtered = await getJson(
        `http://localhost/api/universal/workspace/files?cwd=${encodeURIComponent(tmp)}&q=${encodeURIComponent("b.m")}`
      );
      expect(filtered.data.files.map((f: { path: string }) => f.path)).toEqual(["sub/b.md"]);

      const limited = await getJson(
        `http://localhost/api/universal/workspace/files?cwd=${encodeURIComponent(tmp)}&limit=1`
      );
      expect(limited.data.files).toHaveLength(1);
      expect(limited.data.truncated).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("confines cwd and file to the workspace", async () => {
    const tmp = makeTree();
    try {
      const badCwd = await getJson(
        `http://localhost/api/universal/workspace/files?cwd=${encodeURIComponent(path.join(tmp, "nope"))}`
      );
      expect(badCwd.data.ok).toBe(false);

      const escape = await getJson(
        `http://localhost/api/universal/workspace/read?cwd=${encodeURIComponent(tmp)}&file=${encodeURIComponent("../outside.txt")}`
      );
      expect(escape.data.ok).toBe(false);

      const missing = await getJson(
        `http://localhost/api/universal/workspace/read?cwd=${encodeURIComponent(tmp)}&file=${encodeURIComponent("ghost.txt")}`
      );
      expect(missing.status).toBe(404);
      expect(missing.data.ok).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads text with cap and rejects binaries", async () => {
    const tmp = makeTree();
    try {
      const ok = await getJson(
        `http://localhost/api/universal/workspace/read?cwd=${encodeURIComponent(tmp)}&file=${encodeURIComponent("a.ts")}`
      );
      expect(ok.data.ok).toBe(true);
      expect(ok.data.file).toBe("a.ts");
      expect(ok.data.text).toContain("export const a = 1;");
      expect(ok.data.truncated).toBe(false);

      fs.writeFileSync(path.join(tmp, "bin.dat"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
      const bin = await getJson(
        `http://localhost/api/universal/workspace/read?cwd=${encodeURIComponent(tmp)}&file=${encodeURIComponent("bin.dat")}`
      );
      expect(bin.data.ok).toBe(false);

      fs.writeFileSync(path.join(tmp, "big.txt"), "x".repeat(70000));
      const big = await getJson(
        `http://localhost/api/universal/workspace/read?cwd=${encodeURIComponent(tmp)}&file=${encodeURIComponent("big.txt")}`
      );
      expect(big.data.ok).toBe(true);
      expect(big.data.truncated).toBe(true);
      expect(big.data.text.length).toBeLessThanOrEqual(65536);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
