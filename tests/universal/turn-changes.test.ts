import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TurnChanges } from "@/components/assistant/TurnChanges";

const realFetch = globalThis.fetch;
const realConfirm = globalThis.confirm;

beforeEach(() => {
  (globalThis as any).__calls = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    (globalThis as any).__calls.push(`${init?.method || "GET"} ${String(url)}`);
    const u = String(url);
    const json = (data: any) => ({ ok: true, json: async () => data });
    if (u.includes("/git/status")) {
      return json({ ok: true, repo: "D:/repo", branch: "main", files: [{ path: "a.ts", status: "M", staged: false }] });
    }
    if (u.includes("/git/restore")) {
      return json({ ok: true });
    }
    throw new Error("unexpected fetch: " + u);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.confirm = realConfirm;
  vi.restoreAllMocks();
});

async function renderTurnChanges(props: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(h(QueryClientProvider, { client: qc }, h(TurnChanges, props)));
  });
  // 多轮 flush：query 取数 -> setState -> 重渲染逐轮推进
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
  return { el, root };
}

describe("TurnChanges (per-turn revert)", () => {
  it("lists files with git status and reverts one by one", async () => {
    globalThis.confirm = () => true;
    const { el, root } = await renderTurnChanges({
      open: true, onClose: () => {}, cwd: "D:/repo", files: ["a.ts", "b.ts"],
    });
    expect(el.innerHTML).toContain("a.ts");
    expect(el.innerHTML).toContain("b.ts");
    expect(el.innerHTML).toContain("修改");
    const revertBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("还原") && !b.textContent?.includes("还原中")
    );
    expect(revertBtn).toBeTruthy();
    await act(async () => {
      (revertBtn as HTMLElement).click();
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    }
    expect((globalThis as any).__calls.join("\n")).toContain("POST");
    expect((globalThis as any).__calls.join("\n")).toContain("/git/restore");
    expect(el.innerHTML).toContain("已还原 a.ts");
    root.unmount();
    el.remove();
  });

  it("hides revert actions outside a git repo", async () => {
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes("/git/status")) {
        return { ok: true, json: async () => ({ ok: false, error: "该目录不是 git 仓库" }) };
      }
      throw new Error("unexpected fetch: " + u);
    }) as any;
    const { el, root } = await renderTurnChanges({
      open: true, onClose: () => {}, cwd: "D:/plain", files: ["a.ts"],
    });
    expect(el.innerHTML).toContain("a.ts");
    // 错误态已到，但说明文案含“还原”二字，故断言按钮级：无还原按钮
    expect(
      Array.from(el.querySelectorAll("button")).filter((b) => b.textContent?.includes("还原")).length
    ).toBe(0);
    root.unmount();
    el.remove();
  });
});
