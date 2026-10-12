import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleUniversal } from "../../server/universal/routes";
import { authedRequest } from "../helpers/gateway-auth";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "acp-fs-")));
const root = path.join(base, "ws");
const outside = path.join(base, "outside");
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.mkdirSync(path.join(root, ".git"));
fs.mkdirSync(path.join(root, "node_modules"));
fs.mkdirSync(outside);
fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
fs.writeFileSync(path.join(root, "README.md"), "# hi\n");
fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([1, 0, 2]));
fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
let linked = true;
try { fs.symlinkSync(outside, path.join(root, "escape"), "dir"); } catch { linked = false; }
process.env.ACP_TRASH_DIR = path.join(base, "trash");

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const U = "http://localhost/api/universal/fs";
const q = (o: Record<string, string>) => new URLSearchParams({ cwd: root, ...o }).toString();
async function get(p: string) {
  const res = (await handleUniversal(authedRequest(`${U}${p}`, { method: "GET" })))!;
  return { status: res.status, data: await res.json() };
}
async function post(p: string, body: Record<string, unknown>) {
  const res = (await handleUniversal(authedRequest(`${U}${p}`, { method: "POST", body: JSON.stringify({ cwd: root, ...body }), headers: { "Content-Type": "application/json" } })))!;
  return { status: res.status, data: await res.json() };
}

describe("fs routes", () => {
  it("lists one directory level, dirs first, hiding .git/node_modules", async () => {
    const r = await get(`/list?${q({ dir: "" })}`);
    expect(r.status).toBe(200);
    const names = r.data.entries.map((e: any) => e.name);
    expect(names).not.toContain(".git");
    expect(names).not.toContain("node_modules");
    expect(names.indexOf("src")).toBeLessThan(names.indexOf("README.md"));
    const sub = await get(`/list?${q({ dir: "src" })}`);
    expect(sub.data.entries.map((e: any) => e.path)).toEqual(["src/a.ts"]);
  });

  it("marks symlinks that leave the workspace as non-expandable", async () => {
    if (!linked) return;
    const r = await get(`/list?${q({ dir: "" })}`);
    expect(r.data.entries.find((e: any) => e.name === "escape").type).toBe("other");
    expect((await get(`/list?${q({ dir: "escape" })}`)).status).toBe(403);
    expect((await get(`/read?${q({ path: "escape/secret.txt" })}`)).status).toBe(403);
  });

  it("rejects traversal, absolute paths and dangerous roots", async () => {
    expect((await get(`/read?${q({ path: "../outside/secret.txt" })}`)).status).toBe(403);
    expect((await get(`/read?${q({ path: path.join(outside, "secret.txt") })}`)).status).toBe(400);
    expect((await get(`/list?cwd=${encodeURIComponent(path.parse(root).root)}&dir=`)).status).toBe(403);
    expect((await post("/write", { path: "../x.txt", text: "x" })).status).toBe(403);
    expect((await post("/delete", { path: "" })).status).toBe(400);
  });

  it("reads text with mtime and refuses binaries", async () => {
    const r = await get(`/read?${q({ path: "src/a.ts" })}`);
    expect(r.data.text).toBe("export const a = 1;\n");
    expect(typeof r.data.mtimeMs).toBe("number");
    expect((await get(`/read?${q({ path: "bin.dat" })}`)).status).toBe(415);
  });

  it("writes with optimistic mtime check (409 on conflict, force overrides)", async () => {
    const r = await get(`/read?${q({ path: "src/a.ts" })}`);
    const ok = await post("/write", { path: "src/a.ts", text: "export const a = 2;\n", baseMtimeMs: r.data.mtimeMs });
    expect(ok.status).toBe(200);
    const stale = await post("/write", { path: "src/a.ts", text: "stale", baseMtimeMs: r.data.mtimeMs - 5000 });
    expect(stale.status).toBe(409);
    expect(stale.data.conflict).toBe(true);
    expect(stale.data.text).toBe("export const a = 2;\n");
    expect((await post("/write", { path: "src/a.ts", text: "forced", baseMtimeMs: 1, force: true })).status).toBe(200);
    expect(fs.readFileSync(path.join(root, "src/a.ts"), "utf8")).toBe("forced");
  });

  it("creates, renames and trashes; never touches .git", async () => {
    expect((await post("/create", { path: "docs/new.md", type: "file" })).status).toBe(200);
    expect((await post("/create", { path: "docs/new.md", type: "file" })).status).toBe(409);
    expect((await post("/create", { path: "docs/sub", type: "dir" })).status).toBe(200);
    expect((await post("/rename", { from: "docs/new.md", to: "docs/renamed.md" })).status).toBe(200);
    expect(fs.existsSync(path.join(root, "docs/renamed.md"))).toBe(true);
    const del = await post("/delete", { path: "docs/renamed.md" });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(root, "docs/renamed.md"))).toBe(false);
    expect(fs.existsSync(del.data.trashed)).toBe(true);
    expect((await post("/write", { path: ".git/config", text: "x" })).status).toBe(403);
    expect((await post("/rename", { from: "README.md", to: ".git/README.md" })).status).toBe(403);
  });

  it("streams watch events over SSE", async () => {
    const ac = new AbortController();
    const res = (await handleUniversal(authedRequest(`${U}/watch?${q({})}`, { method: "GET", signal: ac.signal })))!;
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const readUntil = async (pred: (s: string) => boolean, ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end && !pred(buf)) {
        const r = await Promise.race([reader.read(), new Promise<any>((ok) => setTimeout(() => ok({ value: undefined }), 200))]);
        if (r.value) buf += dec.decode(r.value);
        if (r.done) break;
      }
      return pred(buf);
    };
    expect(await readUntil((s) => s.includes('"ready"'), 3000)).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(path.join(root, "watched.txt"), "hi");
    expect(await readUntil((s) => s.includes("watched.txt"), 8000)).toBe(true);
    await reader.cancel();
    ac.abort();
  }, 15000);

  it("requires the gateway token", async () => {
    const res = (await handleUniversal(new Request(`${U}/list?${q({ dir: "" })}`)))!;
    expect(res.status).toBe(401);
  });
});
