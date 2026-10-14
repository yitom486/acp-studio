import { describe, expect, it, vi, beforeAll } from "vitest";
import React, { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  PreviewRail,
  type PreviewRailItem,
} from "@/components/primitives/PreviewRail";
import { MessageScroller } from "@/components/primitives/MessageScroller";
import {
  ActionSwap,
  MagneticButton,
  StatefulButton,
} from "@/components/atoms/MotionButtons";
import {
  SPRING_LAYOUT,
  SPRING_PRESS,
  SPRING_SWAP,
} from "@/lib/motion-primitives";

describe("Stage 1: beUI Motion & MessageScroller & PreviewRail", () => {
  beforeAll(() => {
    // Happy-DOM lacks a complete Web Animations API implementation; stub animate() to prevent AbortError on unmount
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

  it("exports calibrated spring tokens matching beUI specifications", () => {
    expect(SPRING_LAYOUT.stiffness).toBe(360);
    expect(SPRING_LAYOUT.damping).toBe(32);
    expect(SPRING_PRESS.stiffness).toBe(500);
    expect(SPRING_PRESS.damping).toBe(30);
    expect(SPRING_SWAP.stiffness).toBe(460);
    expect(SPRING_SWAP.damping).toBe(30);
  });

  it("renders PreviewRail with pyramid tick buttons and accessible navigation", async () => {
    const items: PreviewRailItem[] = [
      { id: "m1", label: "提问 #1", description: "项目架构分析" },
      { id: "m2", label: "智能体回复", description: "分析完成" },
      { id: "m3", label: "提问 #2", description: "添加单元测试" },
    ];

    const onSelect = vi.fn();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);

    await act(async () => {
      root.render(
        h(PreviewRail, {
          items,
          activeId: "m1",
          onItemSelect: onSelect,
        }),
      );
    });

    // Check rail structure
    const nav = el.querySelector('[data-slot="preview-rail"]');
    expect(nav).toBeTruthy();
    expect(nav?.getAttribute("role")).toBe("navigation");

    // Check ticks
    const ticks = el.querySelectorAll('[data-slot="preview-rail-tick"]');
    expect(ticks.length).toBe(3);

    const buttonItems = el.querySelectorAll('[data-slot="preview-rail-item"]');
    expect(buttonItems.length).toBe(3);
    expect(buttonItems[0].getAttribute("aria-current")).toBe("true");
    expect(buttonItems[1].getAttribute("aria-current")).toBe("false");

    // Click tick
    await act(async () => {
      (buttonItems[1] as HTMLElement).click();
    });
    expect(onSelect).toHaveBeenCalledWith(items[1]);

    await act(async () => {
      root.unmount();
    });
    el.remove();
  });

  it("renders MagneticButton and ActionSwap with slot transition", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);

    await act(async () => {
      root.render(
        h(
          MagneticButton,
          { strength: 0.25 },
          h(ActionSwap, { stateKey: "idle" }, "复制"),
        ),
      );
    });

    const btn = el.querySelector('[data-slot="magnetic-button"]');
    expect(btn).toBeTruthy();
    expect(el.textContent).toContain("复制");

    // Swap state
    await act(async () => {
      root.render(
        h(
          MagneticButton,
          { strength: 0.25 },
          h(ActionSwap, { stateKey: "copied" }, "已复制"),
        ),
      );
    });
    expect(el.textContent).toContain("已复制");

    await act(async () => {
      root.unmount();
    });
    el.remove();
  });

  it("renders StatefulButton transitioning through idle, loading, and success states", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);

    await act(async () => {
      root.render(
        h(StatefulButton, {
          status: "idle",
          idleText: "提交更改",
          loadingText: "生成中…",
          successText: "提交成功",
        }),
      );
    });
    expect(el.textContent).toContain("提交更改");

    await act(async () => {
      root.render(
        h(StatefulButton, {
          status: "loading",
          idleText: "提交更改",
          loadingText: "生成中…",
          successText: "提交成功",
        }),
      );
    });
    expect(el.textContent).toContain("生成中…");

    await act(async () => {
      root.render(
        h(StatefulButton, {
          status: "success",
          idleText: "提交更改",
          loadingText: "生成中…",
          successText: "提交成功",
        }),
      );
    });
    expect(el.textContent).toContain("提交成功");

    await act(async () => {
      root.unmount();
    });
    el.remove();
  });

  it("renders MessageScroller with items and preview navigation rail", async () => {
    const items: PreviewRailItem[] = [
      { id: "msg-1", label: "提问 #1", description: "这是第一个提问" },
      { id: "msg-2", label: "智能体回复", description: "这是第一个回答" },
    ];

    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);

    await act(async () => {
      root.render(
        h(
          MessageScroller,
          { navigation: "rail", items },
          h("div", {
            id: "msg-1",
            "data-slot": "message",
            "data-message-id": "msg-1",
            "data-from": "user",
          }, "这是第一个提问"),
          h("div", {
            id: "msg-2",
            "data-slot": "message",
            "data-message-id": "msg-2",
            "data-from": "assistant",
          }, "这是第一个回答"),
        ),
      );
    });

    const scroller = el.querySelector('[data-slot="message-scroller"]');
    expect(scroller).toBeTruthy();

    const viewport = el.querySelector('[data-slot="message-scroller-viewport"]');
    expect(viewport).toBeTruthy();

    const rail = el.querySelector('[data-slot="preview-rail"]');
    expect(rail).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    el.remove();
  });
});
