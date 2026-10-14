import { describe, expect, it, vi, beforeAll } from "vitest";
import React, { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  FileDiff,
  parseUnifiedDiff,
  type FileDiffLine,
} from "@/components/primitives/FileDiff";
import {
  ImageGeneration,
  type ImageGenerationStatus,
} from "@/components/primitives/ImageGeneration";

describe("Stage 4: beUI FileDiff & ImageGeneration", () => {
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

  describe("FileDiff component & parser", () => {
    it("parses standard unified diff strings accurately with line counters", () => {
      const unifiedPatch = [
        "--- a/src/server.ts",
        "+++ b/src/server.ts",
        "@@ -10,4 +10,5 @@",
        " const port = 3000;",
        "-const app = express();",
        "+const app = new Hono();",
        "+app.use('*', cors());",
        " export default app;",
      ].join("\n");

      const result = parseUnifiedDiff(unifiedPatch);
      expect(result.file).toBe("src/server.ts");
      expect(result.lines.length).toBe(5);

      const added = result.lines.filter((l) => l.type === "added");
      const removed = result.lines.filter((l) => l.type === "removed");
      const context = result.lines.filter((l) => l.type === "context");

      expect(added.length).toBe(2);
      expect(removed.length).toBe(1);
      expect(context.length).toBe(2);

      expect(added[0].content).toBe("const app = new Hono();");
      expect(removed[0].content).toBe("const app = express();");
    });

    it("renders FileDiff with change counts and code lines", async () => {
      const lines: FileDiffLine[] = [
        { id: "l1", type: "context", oldLine: 1, newLine: 1, content: "function calculate() {" },
        { id: "l2", type: "removed", oldLine: 2, content: "  return a + b;" },
        { id: "l3", type: "added", newLine: 2, content: "  const sum = a + b;" },
        { id: "l4", type: "added", newLine: 3, content: "  return Math.round(sum);" },
        { id: "l5", type: "context", oldLine: 3, newLine: 4, content: "}" },
      ];

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          h(FileDiff, {
            file: "src/math.ts",
            lines,
            status: "complete",
            defaultOpen: true,
          }),
        );
      });

      expect(container.textContent).toContain("src/math.ts");
      expect(container.textContent).toContain("+2");
      expect(container.textContent).toContain("−1");
      expect(container.textContent).toContain("Math.round(sum)");

      // Check disclosure button
      const btn = container.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("aria-expanded")).toBe("true");

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });

    it("toggles disclosure open state on click", async () => {
      const lines: FileDiffLine[] = [
        { id: "l1", type: "added", newLine: 1, content: "console.log('hello');" },
      ];

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const onOpenChange = vi.fn();

      await act(async () => {
        root.render(
          h(FileDiff, {
            file: "demo.ts",
            lines,
            status: "complete",
            defaultOpen: true,
            onOpenChange,
          }),
        );
      });

      const btn = container.querySelector("button");
      await act(async () => {
        btn?.click();
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });
  });

  describe("ImageGeneration component", () => {
    it("renders ImageGeneration with resolution badge, prompt, and completed artwork", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          h(
            ImageGeneration,
            {
              status: "complete",
              prompt: "A futuristic solar punk skyline at twilight",
              resolution: "1024 × 1024",
            },
            h("img", { src: "https://example.com/art.png", alt: "Skyline" }),
          ),
        );
      });

      expect(container.textContent).toContain("1024 × 1024");
      expect(container.textContent).toContain("A futuristic solar punk skyline at twilight");
      expect(container.textContent).toContain("图像生成完成");

      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("alt")).toBe("Skyline");

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });

    it("renders retry button when status is error", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const onRetry = vi.fn();

      await act(async () => {
        root.render(
          h(ImageGeneration, {
            status: "error",
            prompt: "Cyberpunk city render",
            onRetry,
          }),
        );
      });

      expect(container.textContent).toContain("生成失败");
      const retryBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("重试生成"),
      );
      expect(retryBtn).toBeDefined();

      await act(async () => {
        retryBtn?.click();
      });
      expect(onRetry).toHaveBeenCalled();

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });
  });
});
