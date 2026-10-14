import { describe, expect, it, vi, beforeAll } from "vitest";
import React, { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { TurnDiffViewer } from "@/components/assistant/TurnDiffViewer";
import * as universalApi from "@/lib/universal-api";

describe("TurnDiffViewer Component", () => {
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

  it("renders changed files pills and count summary", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const files = ["src/components/button.tsx", "src/index.ts"];

    await act(async () => {
      root.render(
        h(TurnDiffViewer, {
          files,
          cwd: "/workspace",
        }),
      );
    });

    expect(container.textContent).toContain("本轮改动了 2 个文件");
    expect(container.textContent).toContain("button.tsx");
    expect(container.textContent).toContain("index.ts");
    expect(container.textContent).toContain("tsx");
    expect(container.textContent).toContain("ts");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("fetches diff and expands FileDiff when file pill is clicked", async () => {
    const gitFileSpy = vi.spyOn(universalApi, "gitFile").mockResolvedValue({
      ok: true,
      repo: "/workspace",
      file: "src/button.tsx",
      binary: false,
      truncated: false,
      before: "export const Button = () => <button />;",
      after: "export const Button = () => <button className='btn' />;",
      unified: [
        "--- a/src/button.tsx",
        "+++ b/src/button.tsx",
        "@@ -1,1 +1,1 @@",
        "-export const Button = () => <button />;",
        "+export const Button = () => <button className='btn' />;",
      ].join("\n"),
    } as any);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        h(TurnDiffViewer, {
          files: ["src/button.tsx"],
          cwd: "/workspace",
        }),
      );
    });

    const buttonPill = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("button.tsx"),
    );
    expect(buttonPill).toBeDefined();

    // Click to expand
    await act(async () => {
      buttonPill?.click();
    });

    expect(gitFileSpy).toHaveBeenCalledWith("/workspace", "src/button.tsx");

    // FileDiff should be rendered inline with diff content
    expect(container.textContent).toContain("button className='btn'");
    expect(container.textContent).toContain("+1");
    expect(container.textContent).toContain("−1");

    gitFileSpy.mockRestore();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
