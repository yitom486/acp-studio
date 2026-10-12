import { useCallback, useEffect, useRef } from "react";

/** 距底部小于该值视为“在底部”（与“回到底部”按钮隐藏的状态一致）。 */
export const STICK_THRESHOLD_PX = 80;

export function distanceFromBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

/**
 * 流式输出跟随：用户在底部时，内容变高（ResizeObserver）就贴住底部；
 * 用户往上滚了就绝不强制滚动，直到他自己回到底部（或点“回到底部”）。
 * - 向上滚轮 / 触摸 / 方向键立即解除跟随，避免与用户“抢”滚动；
 * - 跟随用 rAF 合并到每帧一次、直接设 scrollTop（平滑来自内容本身逐步增长），
 *   不用 smooth 行为，避免连续的平滑动画互相打断导致抖动。
 */
export function useStickToBottom<T extends HTMLElement = HTMLDivElement>() {
  const viewportRef = useRef<T | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const frame = useRef<number | null>(null);
  const lastTop = useRef(0);

  const follow = useCallback(() => {
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const el = viewportRef.current;
      if (!el || !pinned.current) return;
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    const content = contentRef.current;
    if (!el || !content) return;

    const onScroll = () => {
      const movedUp = el.scrollTop < lastTop.current - 1;
      lastTop.current = el.scrollTop;
      const near = distanceFromBottom(el) <= STICK_THRESHOLD_PX;
      // 滚轮 / 键盘向上已在各自监听里立即放手；这里兜住拖滚动条：向上且离开阈值才放手。
      // 内容变矮时浏览器会把 scrollTop 往回夹，那种“向上”仍贴着底，不算用户意图。
      if (movedUp && !near) pinned.current = false;
      else if (near && !movedUp) pinned.current = true;
    };
    const release = () => {
      pinned.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) release();
    };
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(e.key)) release();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", release, { passive: true });
    el.addEventListener("keydown", onKey);
    const ro = new ResizeObserver(follow);
    ro.observe(content);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", release);
      el.removeEventListener("keydown", onKey);
      ro.disconnect();
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [follow]);

  return { viewportRef, contentRef, pinned };
}
