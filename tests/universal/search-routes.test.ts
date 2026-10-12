/**
 * 工作区内容搜索（server/universal/http/search.ts）：rg 解析、walk 回落、端点形状。
 * 只导 searchRouter（不经过 routes.ts），无 chokidar，可独立跑。
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseRgJson, walkSearch, searchRouter } from "../../server/universal/http/search";

const RG_SAMPLE = [
  JSON.stringify({ type: "begin", data: { path: { text: "src/a.ts" } } }),
  JSON.stringify({
    type: "match",
    data: {
      path: { text: "src\\a.ts" },
      lines: { text: "const hello = 1;\n" },
      line_number: 3,
      submatches: [{ m: [6, 11], replacement: null }],
    },
  }),
  JSON.stringify({ type: "match", data: { path: { text: "b.ts" }, lines: { bytes: "e30=" }, line_number: 1, submatches: [] } }),
  "not json at all",
  JSON.stringify({ type: "summary", data: { stats: {} } }),
].join("\n");

describe("parseRgJson", () => {
  it("takes text matches with 1-based cols, skips binary/garbage", () => {
    const { matches, truncated } = parseRgJson(RG_SAMPLE, 100);
    expect(truncated).toBe(false);
    expect(matches).toEqual([{ file: "src/a.ts", line: 3, col: 7, text: "const hello = 1;" }]);
  });

  it("caps matches and reports truncation", () => {
    const { matches, truncated } = parseRgJson(RG_SAMPLE, 1);
    expect(matches.length).toBe(1);
    expect(truncated).toBe(true);
  });
});

describe("walkSearch fallback", () => {
  it("finds text, skips node_modules and binary, smart-cases", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-search-"));
    try {
      fs.mkdirSync(path.join(tmp, "node_modules", "dep"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "hit.ts"), "Hello World\nsecond line\n");
      fs.writeFileSync(path.join(tmp, "node_modules", "dep", "x.js"), "Hello World\n");
      fs.writeFileSync(path.join(tmp, "bin.dat"), Buffer.from([0, 1, 2, 72, 101, 108, 108, 111]));
      // 全小写 → 不分大小写
      const r1 = walkSearch(tmp, "hello", 100);
      expect(r1.matches.map((m) => m.file)).toEqual(["hit.ts"]);
      expect(r1.matches[0]).toMatchObject({ line: 1, col: 1 });
      // 含大写 → 分大小写
      expect(walkSearch(tmp, "Hello", 100).matches.length).toBe(1);
      expect(walkSearch(tmp, "HELLO", 100).matches.length).toBe(0);
      // 上限截断
      expect(walkSearch(tmp, "e", 1).truncated).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("GET / (searchRouter)", () => {
  beforeEach(() => {});
  it("validates cwd and q", async () => {
    const noCwd = await searchRouter.request("/?q=hi");
    expect(noCwd.status).toBe(400);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-search-"));
    try {
      const noQ = await searchRouter.request(`/?cwd=${encodeURIComponent(tmp)}`);
      expect(noQ.status).toBe(400);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns engine + matches + elapsedMs (rg or walk, both honest)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-search-"));
    try {
      fs.writeFileSync(path.join(tmp, "needle.txt"), "find the needle here\n");
      const res = await searchRouter.request(`/?cwd=${encodeURIComponent(tmp)}&q=needle`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(["rg", "walk"]).toContain(data.engine);
      expect(data.matches.length).toBe(1);
      expect(data.matches[0]).toMatchObject({ file: "needle.txt", line: 1 });
      expect(typeof data.elapsedMs).toBe("number");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
