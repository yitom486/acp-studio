"use client";

import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/motion-primitives";
import { cn } from "@/lib/utils";

export type SidebarResourceKind =
  | "folder"
  | "project"
  | "file"
  | "bookmark"
  | "session";

export interface SidebarResource {
  id: string;
  label: string;
  kind: SidebarResourceKind;
  children?: SidebarResource[];
  disabled?: boolean;
  icon?: ReactNode;
  badge?: ReactNode;
  metadata?: Record<string, unknown>;
}

export type SidebarResourceDropPosition = "before" | "inside" | "after";

export interface SidebarResourceMove {
  itemId: string;
  targetId: string | null;
  position: SidebarResourceDropPosition;
}

export interface SidebarResourceMoveCommands {
  up?: () => void;
  down?: () => void;
  into?: { label: string; run: () => void };
  out?: () => void;
}

export interface SidebarResourceMenuControls {
  close: () => void;
  rename: () => void;
  moves: SidebarResourceMoveCommands;
  delete?: () => void;
}

export interface AISidebarProps {
  items?: SidebarResource[];
  defaultItems?: SidebarResource[];
  onItemsChange?: (items: SidebarResource[]) => void;
  /** Reject the promise to roll the optimistic move back. */
  onMove?: (move: SidebarResourceMove) => void | Promise<void>;
  onMoveError?: (error: unknown, move: SidebarResourceMove) => void;
  onRename?: (item: SidebarResource, label: string) => void | Promise<void>;
  onDelete?: (item: SidebarResource) => void | Promise<void>;
  activeId?: string | null;
  defaultActiveId?: string | null;
  onActiveChange?: (id: string) => void;
  onItemClick?: (item: SidebarResource) => void;
  expandedIds?: string[];
  defaultExpandedIds?: string[];
  onExpandedChange?: (ids: string[]) => void;
  renderIcon?: (item: SidebarResource, expanded: boolean) => ReactNode;
  renderMenu?: (
    item: SidebarResource,
    controls: SidebarResourceMenuControls,
  ) => ReactNode;
  ariaLabel?: string;
  className?: string;
}

export interface FlatResource {
  item: SidebarResource;
  depth: number;
  parentId: string | null;
}

export interface DropTarget {
  id: string | null;
  position: SidebarResourceDropPosition;
}

const ROW_REVEAL = {
  duration: 0.16,
  ease: EASE_OUT,
} as const;

export function canContain(item: SidebarResource): boolean {
  return item.kind === "folder" || item.kind === "project";
}

export function flattenResources(
  items: SidebarResource[],
  expanded: ReadonlySet<string>,
  depth = 0,
  parentId: string | null = null,
): FlatResource[] {
  return items.flatMap((item) => {
    const row = { item, depth, parentId };
    if (!item.children?.length || !expanded.has(item.id)) return [row];
    return [
      row,
      ...flattenResources(item.children, expanded, depth + 1, item.id),
    ];
  });
}

export function findResource(
  items: SidebarResource[],
  id: string,
): SidebarResource | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const child = item.children ? findResource(item.children, id) : undefined;
    if (child) return child;
  }
}

export function containsResource(item: SidebarResource, id: string): boolean {
  return (
    item.id === id ||
    item.children?.some((child) => containsResource(child, id)) === true
  );
}

export function removeResource(
  items: SidebarResource[],
  id: string,
): { items: SidebarResource[]; removed?: SidebarResource } {
  let removed: SidebarResource | undefined;
  const next: SidebarResource[] = [];

  for (const item of items) {
    if (item.id === id) {
      removed = item;
      continue;
    }

    if (item.children?.length) {
      const childResult = removeResource(item.children, id);
      if (childResult.removed) {
        removed = childResult.removed;
        next.push({ ...item, children: childResult.items });
        continue;
      }
    }

    next.push(item);
  }

  return { items: next, removed };
}

export function insertResource(
  items: SidebarResource[],
  resource: SidebarResource,
  targetId: string | null,
  position: SidebarResourceDropPosition,
): SidebarResource[] {
  if (targetId === null) return [...items, resource];

  const next: SidebarResource[] = [];
  for (const item of items) {
    if (item.id === targetId) {
      if (position === "before") next.push(resource, item);
      else if (position === "after") next.push(item, resource);
      else next.push({ ...item, children: [...(item.children ?? []), resource] });
      continue;
    }

    if (item.children?.length) {
      next.push({
        ...item,
        children: insertResource(item.children, resource, targetId, position),
      });
    } else {
      next.push(item);
    }
  }
  return next;
}

export function moveResource(
  items: SidebarResource[],
  move: SidebarResourceMove,
): SidebarResource[] | null {
  const source = findResource(items, move.itemId);
  if (!source || source.disabled) return null;
  if (move.targetId && containsResource(source, move.targetId)) return null;

  const target = move.targetId ? findResource(items, move.targetId) : undefined;
  if (
    move.position === "inside" &&
    (!target || target.disabled || !canContain(target))
  )
    return null;

  const removed = removeResource(items, move.itemId);
  if (!removed.removed) return null;
  return insertResource(
    removed.items,
    removed.removed,
    move.targetId,
    move.position,
  );
}

export function renameResource(
  items: SidebarResource[],
  id: string,
  label: string,
): SidebarResource[] {
  return items.map((item) => ({
    ...item,
    label: item.id === id ? label : item.label,
    children: item.children
      ? renameResource(item.children, id, label)
      : undefined,
  }));
}

function defaultIcon(item: SidebarResource, expanded: boolean) {
  if (item.icon) return item.icon;
  const Icon =
    item.kind === "folder" || item.kind === "project"
      ? expanded
        ? FolderOpen
        : Folder
      : item.kind === "bookmark"
      ? Bookmark
      : FileText;
  return <Icon className="size-3.5" />;
}

/**
 * MarqueeLabel:
 * Smoothly scrolls overflowing text horizontally when hovered or active,
 * ensuring users can inspect long session titles or file paths without layout breaking.
 */
export function MarqueeLabel({
  active,
  children,
  className,
}: {
  active: boolean;
  children: string;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const viewportRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const measure = () => {
      const viewport = viewportRef.current;
      const label = labelRef.current;
      if (!viewport || !label) return;
      setDistance(label.scrollWidth > viewport.clientWidth ? label.scrollWidth + 20 : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (labelRef.current) observer.observe(labelRef.current);
    return () => observer.disconnect();
  }, [children]);

  const running = active && distance > 0 && !reduce;

  return (
    <span ref={viewportRef} className={cn("block min-w-0 flex-1 overflow-hidden", className)}>
      <motion.span
        className="flex w-max items-center gap-5 whitespace-nowrap"
        animate={{ x: running ? [0, -distance] : 0 }}
        transition={
          running
            ? {
                duration: Math.max(2.2, distance / 32),
                ease: "linear",
                repeat: Number.POSITIVE_INFINITY,
                repeatDelay: 1.8,
              }
            : ROW_REVEAL
        }
      >
        <span ref={labelRef} className="truncate">{children}</span>
        {running ? <span aria-hidden="true" className="text-muted-foreground/80">{children}</span> : null}
      </motion.span>
    </span>
  );
}

function ResourceMenuAction({
  icon: Icon,
  onSelect,
  destructive = false,
  children,
}: {
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none transition-colors",
        destructive
          ? "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10"
          : "text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

interface ResourceRowProps {
  row: FlatResource;
  active: boolean;
  expanded: boolean;
  focused: boolean;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  menuOpen: boolean;
  moves: SidebarResourceMoveCommands;
  renaming: boolean;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, row: FlatResource) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMenuOpenChange: (open: boolean) => void;
  onRenameCancel: () => void;
  onRenameCommit: (label: string) => void;
  onRenameStart: () => void;
  onDelete?: () => void;
  onSelect: () => void;
  onToggle: () => void;
  onItemClick?: (item: SidebarResource) => void;
  renderIcon?: AISidebarProps["renderIcon"];
  renderMenu?: AISidebarProps["renderMenu"];
  setRef: (node: HTMLDivElement | null) => void;
}

function ResourceRow({
  row,
  active,
  expanded,
  focused,
  draggingId,
  dropTarget,
  menuOpen,
  moves,
  renaming,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onFocus,
  onKeyDown,
  onMenuOpenChange,
  onRenameCancel,
  onRenameCommit,
  onRenameStart,
  onDelete,
  onSelect,
  onToggle,
  onItemClick,
  renderIcon,
  renderMenu,
  setRef,
}: ResourceRowProps) {
  const reduce = useReducedMotion() ?? false;
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipRenameBlurRef = useRef(false);
  const draggedRef = useRef(false);
  const [draft, setDraft] = useState(row.item.label);
  const acceptsChildren = canContain(row.item);
  const isDragging = draggingId === row.item.id;
  const dropPosition = dropTarget?.id === row.item.id ? dropTarget.position : null;

  useEffect(() => {
    if (!renaming) return;
    skipRenameBlurRef.current = false;
    setDraft(row.item.label);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [renaming, row.item.label]);

  const runFromMenu = (action: () => void) => () => {
    onMenuOpenChange(false);
    action();
  };

  const menu = renderMenu?.(row.item, {
    close: () => onMenuOpenChange(false),
    rename: () => {
      onMenuOpenChange(false);
      onRenameStart();
    },
    moves,
    delete: onDelete ? () => {
      onMenuOpenChange(false);
      onDelete();
    } : undefined,
  }) ?? (
    <>
      <ResourceMenuAction icon={Pencil} onSelect={runFromMenu(onRenameStart)}>
        重命名
      </ResourceMenuAction>
      {moves.up || moves.down || moves.into || moves.out ? (
        <div aria-hidden="true" className="my-1 h-px bg-border/60" />
      ) : null}
      {moves.up ? (
        <ResourceMenuAction icon={ArrowUp} onSelect={runFromMenu(moves.up)}>
          上移
        </ResourceMenuAction>
      ) : null}
      {moves.down ? (
        <ResourceMenuAction icon={ArrowDown} onSelect={runFromMenu(moves.down)}>
          下移
        </ResourceMenuAction>
      ) : null}
      {moves.into ? (
        <ResourceMenuAction
          icon={FolderInput}
          onSelect={runFromMenu(moves.into.run)}
        >
          移动到 {moves.into.label}
        </ResourceMenuAction>
      ) : null}
      {moves.out ? (
        <ResourceMenuAction icon={Undo2} onSelect={runFromMenu(moves.out)}>
          移到外层
        </ResourceMenuAction>
      ) : null}
      {onDelete && (
        <>
          <div aria-hidden="true" className="my-1 h-px bg-border/60" />
          <ResourceMenuAction icon={Trash2} destructive onSelect={runFromMenu(onDelete)}>
            删除
          </ResourceMenuAction>
        </>
      )}
    </>
  );

  return (
    <motion.div
      ref={setRef}
      layout="position"
      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={acceptsChildren ? undefined : active}
      aria-expanded={acceptsChildren ? expanded : undefined}
      aria-disabled={row.item.disabled || undefined}
      tabIndex={focused ? 0 : -1}
      draggable={!row.item.disabled && !renaming}
      data-menu-open={menuOpen || undefined}
      data-drop={dropPosition ?? undefined}
      data-dragging={isDragging || undefined}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          draggedRef.current ||
          renaming ||
          row.item.disabled
        )
          return;
        onItemClick?.(row.item);
        if (acceptsChildren) onToggle();
        else onSelect();
      }}
      onContextMenu={(event) => {
        if (row.item.disabled || renaming) return;
        event.preventDefault();
        onMenuOpenChange(true);
      }}
      onDoubleClick={(event) => {
        if (row.item.disabled) return;
        event.preventDefault();
        onRenameStart();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragStartCapture={(event) => {
        draggedRef.current = true;
        onDragStart(event, row.item.id);
      }}
      onDragEndCapture={() => {
        onDragEnd();
        requestAnimationFrame(() => {
          draggedRef.current = false;
        });
      }}
      onDragOver={(event) => onDragOver(event, row)}
      onDrop={onDrop}
      className={cn(
        "group/resource relative flex min-h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md pr-2 text-xs outline-none",
        "text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
        "focus-visible:bg-muted/70 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
        "data-[menu-open=true]:bg-muted data-[menu-open=true]:text-foreground",
        "data-[dragging=true]:opacity-30",
        "data-[drop=inside]:bg-accent/40 data-[drop=inside]:ring-1 data-[drop=inside]:ring-primary/40",
        "data-[drop=before]:before:absolute data-[drop=before]:before:-top-0.5 data-[drop=before]:before:right-2 data-[drop=before]:before:left-2 data-[drop=before]:before:h-0.5 data-[drop=before]:before:rounded-full data-[drop=before]:before:bg-primary",
        "data-[drop=after]:after:absolute data-[drop=after]:after:-bottom-0.5 data-[drop=after]:after:right-2 data-[drop=after]:after:left-2 data-[drop=after]:after:h-0.5 data-[drop=after]:after:rounded-full data-[drop=after]:after:bg-primary",
        !acceptsChildren && active && "bg-accent/80 font-medium text-foreground",
        row.item.disabled && "cursor-not-allowed opacity-45",
      )}
      style={{ paddingLeft: `${8 + row.depth * 14}px` }}
    >
      <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
        {renderIcon?.(row.item, expanded) ?? defaultIcon(row.item, expanded)}
      </span>

      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          aria-label={`Rename ${row.item.label}`}
          onChange={(event) => setDraft(event.target.value)}
          draggable={false}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onBlur={() => {
            if (!skipRenameBlurRef.current) onRenameCommit(draft);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              skipRenameBlurRef.current = true;
              onRenameCommit(draft);
            }
            if (event.key === "Escape") {
              skipRenameBlurRef.current = true;
              onRenameCancel();
            }
          }}
          className="mx-1 h-6 min-w-0 flex-1 rounded border border-primary/50 bg-background px-1.5 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      ) : (
        <MarqueeLabel active={hovered || menuOpen}>{row.item.label}</MarqueeLabel>
      )}

      {row.item.badge && !renaming && (
        <span className="shrink-0">{row.item.badge}</span>
      )}

      {!renaming && !row.item.disabled ? (
        <div className="relative shrink-0">
          <button
            type="button"
            draggable={false}
            tabIndex={-1}
            aria-label={`Actions for ${row.item.label}`}
            onClick={(event) => {
              event.stopPropagation();
              onMenuOpenChange(!menuOpen);
            }}
            className={cn(
              "grid size-5 place-items-center rounded outline-none transition-opacity hover:bg-muted-foreground/10 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring",
              menuOpen ? "opacity-100" : "opacity-0 group-hover/resource:opacity-100",
            )}
          >
            <MoreHorizontal aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </button>

          {/* Context popover */}
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full mt-1 z-50 w-36 rounded-lg border border-border bg-popover/95 p-1 text-popover-foreground shadow-lg backdrop-blur-md animate-in fade-in-0 zoom-in-95"
            >
              <div data-sidebar-resource-menu={row.item.id}>{menu}</div>
            </div>
          )}
        </div>
      ) : null}
    </motion.div>
  );
}

export function AISidebar({
  items,
  defaultItems = [],
  onItemsChange,
  onMove,
  onMoveError,
  onRename,
  onDelete,
  activeId,
  defaultActiveId = null,
  onActiveChange,
  onItemClick,
  expandedIds: controlledExpandedIds,
  defaultExpandedIds = [],
  onExpandedChange,
  renderIcon,
  renderMenu,
  ariaLabel = "Resources",
  className,
}: AISidebarProps) {
  const [internalItems, setInternalItems] = useState(items ?? defaultItems);
  const [internalActiveId, setInternalActiveId] = useState(defaultActiveId);
  const [internalExpandedIds, setInternalExpandedIds] = useState(
    () => new Set(defaultExpandedIds),
  );
  const expandedSet = useMemo(() => {
    return controlledExpandedIds
      ? new Set(controlledExpandedIds)
      : internalExpandedIds;
  }, [controlledExpandedIds, internalExpandedIds]);

  const [focusedId, setFocusedId] = useState<string | null>(
    activeId ?? defaultActiveId,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const movePendingRef = useRef(false);
  const renderedItems = internalItems;
  const selectedId = activeId ?? internalActiveId;

  useEffect(() => {
    if (items) setInternalItems(items);
  }, [items]);

  const flat = useMemo(
    () => flattenResources(renderedItems, expandedSet),
    [expandedSet, renderedItems],
  );

  const focusedRow =
    focusedId !== null && flat.some((row) => row.item.id === focusedId)
      ? focusedId
      : (flat[0]?.item.id ?? null);
  if (focusedId !== focusedRow) setFocusedId(focusedRow);

  // Close menus on outside click or Escape
  useEffect(() => {
    if (!menuOpenId) return;
    const handleOutside = () => setMenuOpenId(null);
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpenId(null);
    };
    window.addEventListener("click", handleOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menuOpenId]);

  const updateItems = useCallback(
    (next: SidebarResource[]) => {
      setInternalItems(next);
      onItemsChange?.(next);
    },
    [onItemsChange],
  );

  const performMove = useCallback(
    async (move: SidebarResourceMove) => {
      if (movePendingRef.current) {
        setAnnouncement("Wait for current move to finish.");
        return;
      }
      const before = renderedItems;
      const next = moveResource(before, move);
      if (!next || next === before) return;

      movePendingRef.current = true;
      updateItems(next);
      setDropTarget(null);
      setDraggingId(null);
      const moved = findResource(before, move.itemId);
      const target = move.targetId ? findResource(before, move.targetId) : null;
      setAnnouncement(
        target
          ? `Moved ${moved?.label ?? "item"} ${move.position} ${target.label}.`
          : `Moved ${moved?.label ?? "item"} to top level.`,
      );

      try {
        await onMove?.(move);
      } catch (error) {
        updateItems(before);
        setAnnouncement(`Move failed. ${moved?.label ?? "Item"} was restored.`);
        onMoveError?.(error, move);
      } finally {
        movePendingRef.current = false;
      }
    },
    [onMove, onMoveError, renderedItems, updateItems],
  );

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  }, []);

  const select = useCallback(
    (id: string) => {
      if (activeId === undefined) setInternalActiveId(id);
      onActiveChange?.(id);
    },
    [activeId, onActiveChange],
  );

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(expandedSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      if (controlledExpandedIds === undefined) {
        setInternalExpandedIds(next);
      }
      onExpandedChange?.(Array.from(next));
    },
    [controlledExpandedIds, expandedSet, onExpandedChange],
  );

  const moveCommands = useCallback(
    (row: FlatResource): SidebarResourceMoveCommands => {
      if (row.item.disabled) return {};
      const index = flat.findIndex(({ item }) => item.id === row.item.id);
      const previous = flat[index - 1];
      const next = flat[index + 1];
      const parentId = row.parentId;
      const commands: SidebarResourceMoveCommands = {};

      if (previous) {
        commands.up = () =>
          void performMove({
            itemId: row.item.id,
            targetId: previous.item.id,
            position: "before",
          });
      }
      if (next) {
        commands.down = () =>
          void performMove({
            itemId: row.item.id,
            targetId: next.item.id,
            position: "after",
          });
      }
      if (previous && canContain(previous.item) && previous.item.id !== parentId) {
        commands.into = {
          label: previous.item.label,
          run: () => {
            const nextExp = new Set(expandedSet).add(previous.item.id);
            if (controlledExpandedIds === undefined) {
              setInternalExpandedIds(nextExp);
            }
            onExpandedChange?.(Array.from(nextExp));
            void performMove({
              itemId: row.item.id,
              targetId: previous.item.id,
              position: "inside",
            });
          },
        };
      }
      if (parentId) {
        commands.out = () =>
          void performMove({
            itemId: row.item.id,
            targetId: parentId,
            position: "after",
          });
      }

      return commands;
    },
    [controlledExpandedIds, expandedSet, flat, onExpandedChange, performMove],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, row: FlatResource) => {
      const index = flat.findIndex(({ item }) => item.id === row.item.id);
      const previous = flat[index - 1];
      const next = flat[index + 1];
      const moveModifier = event.altKey && event.shiftKey;

      if (event.key === "ArrowDown" && !moveModifier && next) {
        event.preventDefault();
        focusRow(next.item.id);
        return;
      }
      if (event.key === "ArrowUp" && !moveModifier && previous) {
        event.preventDefault();
        focusRow(previous.item.id);
        return;
      }
      if (event.key === "Home" && flat[0]) {
        event.preventDefault();
        focusRow(flat[0].item.id);
        return;
      }
      if (event.key === "End" && flat.at(-1)) {
        event.preventDefault();
        focusRow(flat.at(-1)?.item.id ?? row.item.id);
        return;
      }

      if (row.item.disabled) {
        if (event.key === "ArrowLeft" && row.parentId) {
          event.preventDefault();
          focusRow(row.parentId);
        }
        return;
      }

      if (moveModifier && event.key === "ArrowUp" && previous) {
        event.preventDefault();
        void performMove({ itemId: row.item.id, targetId: previous.item.id, position: "before" });
        return;
      }
      if (moveModifier && event.key === "ArrowDown" && next) {
        event.preventDefault();
        void performMove({ itemId: row.item.id, targetId: next.item.id, position: "after" });
        return;
      }
      if (moveModifier && event.key === "ArrowRight" && previous && canContain(previous.item)) {
        event.preventDefault();
        const nextExp = new Set(expandedSet).add(previous.item.id);
        if (controlledExpandedIds === undefined) {
          setInternalExpandedIds(nextExp);
        }
        onExpandedChange?.(Array.from(nextExp));
        void performMove({ itemId: row.item.id, targetId: previous.item.id, position: "inside" });
        return;
      }
      if (moveModifier && event.key === "ArrowLeft" && row.parentId) {
        event.preventDefault();
        void performMove({ itemId: row.item.id, targetId: row.parentId, position: "after" });
        return;
      }

      if (event.key === "ArrowRight" && canContain(row.item)) {
        event.preventDefault();
        if (!expandedSet.has(row.item.id)) toggle(row.item.id);
        else if (next?.parentId === row.item.id) focusRow(next.item.id);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (expandedSet.has(row.item.id)) toggle(row.item.id);
        else if (row.parentId) focusRow(row.parentId);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (canContain(row.item)) toggle(row.item.id);
        else select(row.item.id);
      } else if (event.key === "F2") {
        event.preventDefault();
        setRenamingId(row.item.id);
      } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        setMenuOpenId(row.item.id);
      }
    },
    [controlledExpandedIds, expandedSet, flat, focusRow, onExpandedChange, performMove, select, toggle],
  );

  return (
    <>
      <div
        role="tree"
        aria-label={ariaLabel}
        aria-multiselectable="false"
        onDragOver={(event) => {
          if (!draggingId || event.target !== event.currentTarget) return;
          event.preventDefault();
          setDropTarget({ id: null, position: "after" });
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (draggingId && dropTarget) {
            void performMove({
              itemId: draggingId,
              targetId: dropTarget.id,
              position: dropTarget.position,
            });
          }
        }}
        className={cn(
          "relative flex min-w-0 flex-col gap-0.5 select-none",
          draggingId && "pb-8",
          className,
        )}
      >
        <AnimatePresence initial={false}>
          {flat.map((row) => (
            <ResourceRow
              key={row.item.id}
              row={row}
              active={selectedId === row.item.id}
              expanded={expandedSet.has(row.item.id)}
              focused={focusedRow === row.item.id}
              draggingId={draggingId}
              dropTarget={dropTarget}
              menuOpen={menuOpenId === row.item.id}
              moves={moveCommands(row)}
              renaming={renamingId === row.item.id}
              onFocus={() => setFocusedId(row.item.id)}
              onSelect={() => select(row.item.id)}
              onToggle={() => toggle(row.item.id)}
              onItemClick={onItemClick}
              onKeyDown={(event) => handleKeyDown(event, row)}
              onRenameStart={() => setRenamingId(row.item.id)}
              onRenameCancel={() => setRenamingId(null)}
              onRenameCommit={(label) => {
                const trimmed = label.trim();
                setRenamingId(null);
                if (!trimmed || trimmed === row.item.label) return;
                const before = renderedItems;
                updateItems(renameResource(before, row.item.id, trimmed));
                void Promise.resolve(onRename?.(row.item, trimmed)).catch(() => {
                  updateItems(before);
                  setAnnouncement(`Rename failed. ${row.item.label} was restored.`);
                });
              }}
              onDelete={onDelete ? () => {
                const before = renderedItems;
                const removed = removeResource(before, row.item.id);
                updateItems(removed.items);
                void Promise.resolve(onDelete(row.item)).catch(() => {
                  updateItems(before);
                  setAnnouncement(`Delete failed. ${row.item.label} was restored.`);
                });
              } : undefined}
              onMenuOpenChange={(open) => {
                setMenuOpenId(open ? row.item.id : null);
                if (!open) focusRow(row.item.id);
              }}
              onDragStart={(event, id) => {
                setDraggingId(id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTarget(null);
              }}
              onDragOver={(event, targetRow) => {
                if (!draggingId || draggingId === targetRow.item.id) return;
                const source = findResource(renderedItems, draggingId);
                if (source && containsResource(source, targetRow.item.id)) return;
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientY - rect.top) / rect.height;
                const position =
                  !targetRow.item.disabled &&
                  canContain(targetRow.item) &&
                  ratio >= 0.25 &&
                  ratio <= 0.75
                    ? "inside"
                    : ratio < 0.5
                    ? "before"
                    : "after";
                setDropTarget({ id: targetRow.item.id, position });
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (draggingId && dropTarget) {
                  void performMove({
                    itemId: draggingId,
                    targetId: dropTarget.id,
                    position: dropTarget.position,
                  });
                }
              }}
              renderIcon={renderIcon}
              renderMenu={renderMenu}
              setRef={(node) => {
                if (node) rowRefs.current.set(row.item.id, node);
                else rowRefs.current.delete(row.item.id);
              }}
            />
          ))}
        </AnimatePresence>

        {draggingId ? (
          <div
            aria-hidden="true"
            data-active={dropTarget?.id === null || undefined}
            className="mt-1 flex h-7 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground transition-colors data-[active=true]:border-primary data-[active=true]:bg-accent/40 data-[active=true]:text-foreground"
          >
            移到最外层
          </div>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
