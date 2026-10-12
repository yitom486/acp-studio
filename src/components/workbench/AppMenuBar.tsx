/**
 * 标题栏里的应用菜单（Windows / Linux / 浏览器；macOS 用系统菜单栏）。
 * 菜单结构与 desktop/menu.ts 一致，全部调用命令注册表。
 */
import React, { useEffect, useRef, useState } from "react";
import { getCommand, runCommand, formatKey } from "@/lib/commands";
import { cn } from "@/lib/utils";

type Item = { cmd: string; label?: string } | "sep";
export const APP_MENU: Array<{ label: string; items: Item[] }> = [
  { label: "文件", items: [{ cmd: "window.new" }, { cmd: "session.new" }, "sep", { cmd: "workspace.openFolder" }, { cmd: "workspace.openRecent" }, "sep", { cmd: "editor.save" }, { cmd: "editor.closeTab" }, "sep", { cmd: "workspace.reveal" }, { cmd: "workspace.copyPath" }, "sep", { cmd: "settings.open" }] },
  { label: "编辑", items: [{ cmd: "edit.undo" }, { cmd: "edit.redo" }, "sep", { cmd: "edit.cut" }, { cmd: "edit.copy" }, { cmd: "edit.paste" }, { cmd: "edit.selectAll" }] },
  { label: "视图", items: [{ cmd: "palette.open" }, "sep", { cmd: "view.toggleSidebar" }, { cmd: "view.toggleFileTree" }, { cmd: "view.toggleTerminal" }, { cmd: "view.toggleTheme" }] },
  { label: "帮助", items: [{ cmd: "update.check" }, { cmd: "help.changelog" }, { cmd: "help.issues" }, "sep", { cmd: "settings.about" }] },
];

export const AppMenuBar: React.FC = () => {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open == null) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="flex items-center app-no-drag ml-2" role="menubar">
      {APP_MENU.map((m, i) => (
        <div key={m.label} className="relative">
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open != null && setOpen(i)}
            className={cn("h-6 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors", open === i && "bg-muted text-foreground")}
          >
            {m.label}
          </button>
          {open === i && (
            <div role="menu" className="absolute left-0 top-full z-50 mt-1 min-w-60 rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-lg">
              {m.items.map((it, j) => {
                if (it === "sep") return <div key={j} className="my-1 h-px bg-border" />;
                const c = getCommand(it.cmd);
                if (!c) return null;
                const disabled = c.when ? !c.when() : false;
                return (
                  <button
                    key={it.cmd}
                    role="menuitem"
                    disabled={disabled}
                    onClick={() => { setOpen(null); void runCommand(it.cmd); }}
                    className="flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <span>{it.label || c.title}</span>
                    {c.keybinding && <span className="font-mono text-[11px] text-muted-foreground">{formatKey(c.keybinding)}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
