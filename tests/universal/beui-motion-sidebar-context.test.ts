import { describe, expect, it, vi, beforeAll } from "vitest";
import React, { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuShortcut,
} from "@/components/motion/ContextMenu";
import { PullToRefresh } from "@/components/motion/PullToRefresh";
import { SessionRow, type SessionItem } from "@/components/universal/Sidebar";

describe("Stage 5: beUI Animated ContextMenu & PullToRefresh for Sidebar", () => {
  beforeAll(() => {
    if (typeof Element !== "undefined") {
      Element.prototype.animate = () =>
        ({
          onfinish: null,
          oncancel: null,
          finish: () => {},
          cancel: () => {},
          play: () => {},
          pause: () => {},
          reverse: () => {},
          currentTime: 0,
          startTime: 0,
          playbackRate: 1,
          playState: "finished",
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
          ready: Promise.resolve(),
          finished: Promise.resolve(),
        } as any);
    }
  });

  it("renders ContextMenu and opens on contextmenu event", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onSelectAction = vi.fn();

    await act(async () => {
      root.render(
        h(
          ContextMenu,
          null,
          h(
            ContextMenuTrigger,
            null,
            h("div", { id: "trigger-box", className: "p-4" }, "Trigger Area")
          ),
          h(
            ContextMenuContent,
            null,
            h(ContextMenuLabel, null, "会话操作"),
            h(ContextMenuItem, { onSelect: onSelectAction }, "重命名"),
            h(ContextMenuSeparator, null),
            h(ContextMenuItem, { tone: "destructive", onSelect: vi.fn() }, "删除")
          )
        )
      );
    });

    const trigger = container.querySelector("#trigger-box");
    expect(trigger).not.toBeNull();

    // Trigger contextmenu
    await act(async () => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 150,
      });
      trigger?.dispatchEvent(event);
    });

    // Check menu portal mounted to body
    const portal = document.querySelector('[data-context-menu-portal=""]');
    expect(portal).not.toBeNull();
    expect(document.body.textContent).toContain("会话操作");
    expect(document.body.textContent).toContain("重命名");
    expect(document.body.textContent).toContain("删除");

    // Click item
    const renameItem = Array.from(document.querySelectorAll('[data-context-menu-item="true"]')).find(
      (el) => el.textContent?.includes("重命名")
    );
    expect(renameItem).toBeDefined();

    await act(async () => {
      (renameItem as HTMLElement)?.click();
    });
    expect(onSelectAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("integrates ContextMenu into SessionRow without native ugly title tooltip", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const session: SessionItem = {
      sessionId: "ses_beui_test_123",
      title: "为系统接入生成式 UI 能力",
      updatedAt: new Date().toISOString(),
    };

    const onOpen = vi.fn();
    const onFork = vi.fn();
    const onDelete = vi.fn();

    await act(async () => {
      root.render(
        h(SessionRow, {
          session,
          active: false,
          supportsFork: true,
          onOpen,
          onFork,
          onDelete,
        })
      );
    });

    // Verify session title is displayed
    expect(container.textContent).toContain("为系统接入生成式 UI 能力");

    // Verify native title tooltip is removed so it doesn't pop up white box
    const titleElements = container.querySelectorAll('[title="为系统接入生成式 UI 能力"]');
    expect(titleElements.length).toBe(0);

    // Right-click session row to summon BeUI ContextMenu
    const sessionDiv = container.querySelector(".group");
    await act(async () => {
      sessionDiv?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 120,
        })
      );
    });

    // Verify context menu options
    expect(document.body.textContent).toContain("进入会话");
    expect(document.body.textContent).toContain("分叉新会话 (Fork)");
    expect(document.body.textContent).toContain("复制会话标题");
    expect(document.body.textContent).toContain("复制会话 ID");
    expect(document.body.textContent).toContain("删除此会话");

    // Click "删除此会话"
    const deleteItem = Array.from(document.querySelectorAll('[data-context-menu-item="true"]')).find(
      (el) => el.textContent?.includes("删除此会话")
    );
    await act(async () => {
      (deleteItem as HTMLElement)?.click();
    });
    expect(onDelete).toHaveBeenCalledWith(session);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders PullToRefresh and displays child content", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onRefresh = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        h(
          PullToRefresh,
          { onRefresh, refreshing: false },
          h("div", { id: "child-list" }, "Session List Content")
        )
      );
    });

    expect(container.textContent).toContain("Session List Content");
    expect(container.textContent).toContain("下拉刷新会话");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
