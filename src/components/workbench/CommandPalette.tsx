import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { listCommands, runCommand, subscribeCommands, formatKey } from "@/lib/commands";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { cn } from "@/lib/utils";

/** 命令面板（Ctrl/⌘+Shift+P）：模糊匹配所有注册命令。 */
export const CommandPalette: React.FC = () => {
  const open = useWorkbenchStore((s) => s.paletteOpen);
  const setOpen = useWorkbenchStore((s) => s.setPaletteOpen);
  const initialQuery = useWorkbenchStore((s) => s.paletteQuery);
  const version = useSyncExternalStore(subscribeCommands, () => listCommands().length);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const all = listCommands().filter((c) => c.id !== "palette.open");
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all
      .map((c) => ({ c, s: `${c.group ?? ""} ${c.title} ${c.id}`.toLowerCase() }))
      .filter(({ s }) => needle.split(/\s+/).every((w) => s.includes(w)))
      .map(({ c }) => c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, version]);

  useEffect(() => {
    if (open) {
      setQ(initialQuery);
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open, initialQuery]);
  useEffect(() => setSel(0), [q]);

  if (!open) return null;
  const run = (id: string) => {
    setOpen(false);
    void runCommand(id);
  };
  return (
    <div className="fixed inset-0 z-[85] flex justify-center bg-black/30 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-label="命令面板" className="h-fit w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="输入命令…"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === "Enter" && items[sel]) run(items[sel].id);
            }}
          />
        </div>
        <div className="max-h-[360px] overflow-y-auto p-1">
          {items.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">没有匹配的命令</div>}
          {items.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(c.id)}
              className={cn("flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px]", i === sel ? "bg-accent text-foreground" : "text-muted-foreground")}
            >
              <span>
                {c.group && <span className="text-muted-foreground">{c.group}：</span>}
                {c.title}
              </span>
              {c.keybinding && <kbd className="font-mono text-[11px] text-muted-foreground">{formatKey(c.keybinding)}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
