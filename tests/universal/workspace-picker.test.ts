/**
 * 内置工作区/目录选择面板 (WorkspacePickerModal) 单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { WorkspacePickerModal } from "@/components/universal/WorkspacePickerModal";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";

const realFetch = globalThis.fetch;

function mockFetchDirectory() {
  globalThis.fetch = (async (input: unknown) => {
    const u = String(input);
    if (u.includes("/workspace/directories")) {
      return Response.json({
        ok: true,
        current: "D:\\project\\test-app",
        displayPath: "D:\\project\\test-app",
        parent: "D:\\project",
        roots: [
          { label: "用户目录 (~)", path: "C:\\Users\\alice" },
          { label: "本地磁盘 (D:)", path: "D:\\" },
        ],
        entries: [
          { name: "backend", path: "D:\\project\\test-app\\backend", isGit: true },
          { name: "frontend", path: "D:\\project\\test-app\\frontend", isGit: false },
        ],
      });
    }
    return Response.json({ ok: false, error: "unexpected" }, { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  mockFetchDirectory();
  useWorkbenchStore.setState({
    workspacePickerOpen: false,
    workspacePickerDistro: null,
    workspacePickerInitialPath: null,
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  useWorkbenchStore.setState({
    workspacePickerOpen: false,
    workspacePickerDistro: null,
    workspacePickerInitialPath: null,
  });
});

async function renderModal() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(h(WorkspacePickerModal, null));
    await new Promise((r) => setTimeout(r, 60));
  });
  return { el, root };
}

describe("WorkspacePickerModal", () => {
  it("renders nothing when closed", async () => {
    const { el, root } = await renderModal();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    root.unmount();
    el.remove();
  });

  it("renders directories and breadcrumbs when open", async () => {
    useWorkbenchStore.getState().openWorkspacePicker();
    const { el, root } = await renderModal();

    expect(el.querySelector('[role="dialog"]')).toBeTruthy();
    expect(el.textContent).toContain("打开工作区文件夹");
    expect(el.textContent).toContain("backend");
    expect(el.textContent).toContain("frontend");
    expect(el.textContent).toContain("git");

    root.unmount();
    el.remove();
  });

  it("filters directory entries by query input", async () => {
    useWorkbenchStore.getState().openWorkspacePicker();
    const { el, root } = await renderModal();

    const input = el.querySelector('input[placeholder*="过滤"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;

    await act(async () => {
      nativeInputValueSetter?.call(input, "front");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(el.textContent).toContain("frontend");
    expect(el.textContent).not.toContain("backend");

    root.unmount();
    el.remove();
  });

  it("closes when close button is clicked", async () => {
    useWorkbenchStore.getState().openWorkspacePicker();
    const { el, root } = await renderModal();

    const closeBtn = el.querySelector('button[title*="关闭"]') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();

    await act(async () => {
      closeBtn.click();
    });

    expect(useWorkbenchStore.getState().workspacePickerOpen).toBe(false);

    root.unmount();
    el.remove();
  });
});
