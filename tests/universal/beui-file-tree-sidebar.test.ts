import { describe, expect, it, vi, beforeAll } from "vitest";
import React, { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  FileTree,
  FileTreeFolder,
  FileTreeFile,
  flattenFileTreeItems,
  type FileTreeItem,
} from "@/components/primitives/FileTree";
import {
  AISidebar,
  moveResource,
  renameResource,
  removeResource,
  insertResource,
  flattenResources,
  containsResource,
  MarqueeLabel,
  type SidebarResource,
} from "@/components/primitives/AISidebar";
import { SharedLayoutBg } from "@/components/motion/SharedLayoutBg";
import { SessionRow, type SessionItem } from "@/components/universal/Sidebar";

describe("Stage 3: beUI FileTree, AISidebar & SharedLayoutBg", () => {
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

  describe("FileTree primitives and flattening", () => {
    it("correctly flattens nested folder/file hierarchies based on expanded Set", () => {
      const items: FileTreeItem[] = [
        {
          value: "src",
          name: "src",
          type: "folder",
          children: [
            {
              value: "components",
              name: "components",
              type: "folder",
              children: [
                { value: "button.tsx", name: "Button.tsx", type: "file" },
              ],
            },
            { value: "main.ts", name: "main.ts", type: "file" },
          ],
        },
        { value: "package.json", name: "package.json", type: "file" },
      ];

      // Case 1: None expanded
      const flatClosed = flattenFileTreeItems(items, new Set());
      expect(flatClosed.map((f) => f.item.value)).toEqual(["src", "package.json"]);

      // Case 2: "src" expanded, "components" closed
      const flatSrc = flattenFileTreeItems(items, new Set(["src"]));
      expect(flatSrc.map((f) => f.item.value)).toEqual([
        "src",
        "components",
        "main.ts",
        "package.json",
      ]);

      // Case 3: "src" and "components" expanded
      const flatAll = flattenFileTreeItems(items, new Set(["src", "components"]));
      expect(flatAll.map((f) => f.item.value)).toEqual([
        "src",
        "components",
        "button.tsx",
        "main.ts",
        "package.json",
      ]);
      expect(flatAll.find((f) => f.item.value === "button.tsx")?.depth).toBe(2);
    });

    it("renders FileTree with declarative children and handles folder expand/select", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      const onSelect = vi.fn();
      const onExpand = vi.fn();

      await act(async () => {
        root.render(
          h(
            FileTree,
            {
              value: "file-2",
              onValueChange: onSelect,
              defaultExpandedIds: ["folder-1"],
              onExpandedChange: onExpand,
              ariaLabel: "Test File Tree",
            },
            h(
              FileTreeFolder,
              { value: "folder-1", name: "Root Folder" },
              h(FileTreeFile, { value: "file-1", name: "Alpha.ts" }),
              h(FileTreeFile, { value: "file-2", name: "Beta.tsx" }),
            ),
            h(FileTreeFile, { value: "readme", name: "README.md" }),
          ),
        );
      });

      const tree = container.querySelector('[role="tree"]');
      expect(tree).not.toBeNull();
      expect(tree?.getAttribute("aria-label")).toBe("Test File Tree");

      const treeitems = container.querySelectorAll('[role="treeitem"]');
      expect(treeitems.length).toBe(4); // folder-1, file-1, file-2, readme

      // Click on file-1
      const alphaBtn = Array.from(treeitems).find((el) =>
        el.textContent?.includes("Alpha.ts"),
      ) as HTMLButtonElement | undefined;
      expect(alphaBtn).toBeDefined();

      await act(async () => {
        alphaBtn?.click();
      });
      expect(onSelect).toHaveBeenCalledWith("file-1");

      // Click folder-1 to toggle collapse
      const folderBtn = Array.from(treeitems).find((el) =>
        el.textContent?.includes("Root Folder"),
      ) as HTMLButtonElement | undefined;

      await act(async () => {
        folderBtn?.click();
      });
      expect(onExpand).toHaveBeenCalled();

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });
  });

  describe("AISidebar optimistic reordering & mutations", () => {
    const initialItems: SidebarResource[] = [
      {
        id: "proj-1",
        label: "Project Alpha",
        kind: "project",
        children: [
          { id: "sess-1", label: "Session 1", kind: "session" },
          { id: "sess-2", label: "Session 2", kind: "session" },
        ],
      },
      {
        id: "proj-2",
        label: "Project Beta",
        kind: "project",
        children: [{ id: "sess-3", label: "Session 3", kind: "session" }],
      },
    ];

    it("moves an item before another item in the same folder", () => {
      const moved = moveResource(initialItems, {
        itemId: "sess-2",
        targetId: "sess-1",
        position: "before",
      });
      expect(moved).not.toBeNull();
      const proj1Children = moved![0].children?.map((c) => c.id);
      expect(proj1Children).toEqual(["sess-2", "sess-1"]);
    });

    it("moves an item into another folder (cross-folder reparenting)", () => {
      const moved = moveResource(initialItems, {
        itemId: "sess-1",
        targetId: "proj-2",
        position: "inside",
      });
      expect(moved).not.toBeNull();
      expect(moved![0].children?.map((c) => c.id)).toEqual(["sess-2"]);
      expect(moved![1].children?.map((c) => c.id)).toEqual(["sess-3", "sess-1"]);
    });

    it("prevents invalid cyclical move into own descendant", () => {
      expect(containsResource(initialItems[0], "sess-1")).toBe(true);
      const invalidMove = moveResource(initialItems, {
        itemId: "proj-1",
        targetId: "sess-1",
        position: "inside",
      });
      expect(invalidMove).toBeNull();
    });

    it("renames an item accurately without corrupting sibling structure", () => {
      const renamed = renameResource(initialItems, "sess-1", "Renamed Session");
      expect(renamed[0].children?.[0].label).toBe("Renamed Session");
      expect(renamed[0].children?.[1].label).toBe("Session 2");
    });
  });

  describe("MarqueeLabel and SessionRow integration", () => {
    it("renders MarqueeLabel cleanly with overflowing text", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          h(
            MarqueeLabel,
            { active: true, className: "test-marquee" },
            "Very long session title that describes complex codebase refactoring operations",
          ),
        );
      });

      expect(container.textContent).toContain("Very long session title");

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });

    it("renders upgraded SessionRow with MarqueeLabel and active status", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      const session: SessionItem = {
        sessionId: "sess-test-12345678",
        title: "重构组件库与动效系统并接入 beUI FileTree",
        updatedAt: new Date(Date.now() - 120000).toISOString(),
      };

      const onOpen = vi.fn();
      const onFork = vi.fn();
      const onDelete = vi.fn();

      await act(async () => {
        root.render(
          h(SessionRow, {
            session,
            active: true,
            supportsFork: true,
            onOpen,
            onFork,
            onDelete,
          }),
        );
      });

      expect(container.textContent).toContain("重构组件库与动效系统并接入 beUI FileTree");
      // Has active session indicator
      const activeDot = container.querySelector('[title="活动会话"]');
      expect(activeDot).not.toBeNull();

      // Click row
      const row = container.querySelector(".group");
      await act(async () => {
        (row as HTMLElement)?.click();
      });
      expect(onOpen).toHaveBeenCalledWith(session);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });
  });
});
