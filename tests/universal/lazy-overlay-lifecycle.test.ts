import { act, createElement as h, lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MountOnFirstOpen } from "../../src/components/MountOnFirstOpen";

describe("lazy overlay lifecycle", () => {
  it("loads only on first open and preserves child state/resources across close and reopen", async () => {
    const mounted = vi.fn(), released = vi.fn();
    function StatefulPreview({ isOpen }: { isOpen: boolean }) {
      const [count, setCount] = useState(0);
      useEffect(() => { mounted(); return released; }, []);
      return h("button", { hidden: !isOpen, onClick: () => setCount(count + 1) }, String(count));
    }
    const load = vi.fn(async () => ({ default: StatefulPreview }));
    const Preview = lazy(load);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = async (isOpen: boolean) => act(async () => {
      root.render(h(MountOnFirstOpen, { isOpen, children:
        h(Suspense, { fallback: isOpen ? "Loading" : null }, h(Preview, { isOpen }))
      }));
    });
    try {
      await render(false);
      expect(load).not.toHaveBeenCalled();
      expect(host.innerHTML).toBe("");
      await render(true);
      expect(load).toHaveBeenCalledTimes(1);
      expect(mounted).toHaveBeenCalledTimes(1);
      await act(async () => host.querySelector("button")!.click());
      await render(false);
      expect(released).not.toHaveBeenCalled();
      expect(host.querySelector("button")!.hidden).toBe(true);
      await render(true);
      expect(host.querySelector("button")!.textContent).toBe("1");
      expect(load).toHaveBeenCalledTimes(1);
      expect(mounted).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
    expect(released).toHaveBeenCalledTimes(1);
  });
  it("mounts immediately when initially open", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(h(MountOnFirstOpen, { isOpen: true, children: "Already open" })));
      expect(host.textContent).toBe("Already open");
    } finally { await act(async () => root.unmount()); }
  });
});
