import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Terminal as TerminalIcon, X, Maximize2, Minimize2, Trash2, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cwd: string | null;
}

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({ isOpen, onClose, cwd }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [maximized, setMaximized] = useState(false);
  const runningRef = useRef(false);
  const currentLineRef = useRef("");
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);

  const activeCwd = cwd || "D:\\project\\js\\Electron\\antigravity-acp";

  const printPrompt = (t: Terminal) => {
    const short = activeCwd.split(/[/\\]/).filter(Boolean).pop() || activeCwd;
    t.write(`\r\n\x1b[36mPS ${short}\x1b[0m\x1b[90m>\x1b[0m `);
  };

  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    if (!termRef.current) {
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.25,
        theme: {
          background: "#0b0e14",
          foreground: "#e2e8f0",
          cursor: "#38bdf8",
          cursorAccent: "#0b0e14",
          selectionBackground: "rgba(56, 189, 248, 0.3)",
          black: "#1e293b",
          red: "#f87171",
          green: "#4ade80",
          yellow: "#facc15",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#38bdf8",
          white: "#f8fafc",
        },
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      termRef.current = term;
      fitAddonRef.current = fit;

      // Welcome header
      term.writeln("\x1b[1;34m=== ACP Studio Integrated Terminal ===\x1b[0m");
      term.writeln(`\x1b[90m工作目录:\x1b[0m \x1b[33m${activeCwd}\x1b[0m`);
      term.writeln("\x1b[90m支持 PowerShell / 命令执行，按 Enter 运行，支持快捷键 Ctrl+` 开关\x1b[0m");
      printPrompt(term);

      // Handle key input
      term.onData((data) => {
        if (runningRef.current) return;

        // Enter
        if (data === "\r") {
          const cmd = currentLineRef.current.trim();
          currentLineRef.current = "";
          historyIdxRef.current = -1;
          if (cmd) {
            historyRef.current.push(cmd);
            executeCommand(cmd, term);
          } else {
            printPrompt(term);
          }
          return;
        }

        // Backspace
        if (data === "\x7f" || data === "\b") {
          if (currentLineRef.current.length > 0) {
            currentLineRef.current = currentLineRef.current.slice(0, -1);
            term.write("\b \b");
          }
          return;
        }

        // Arrow Up (history)
        if (data === "\x1b[A") {
          if (historyRef.current.length > 0) {
            const nextIdx = historyIdxRef.current === -1
              ? historyRef.current.length - 1
              : Math.max(0, historyIdxRef.current - 1);
            historyIdxRef.current = nextIdx;
            const target = historyRef.current[nextIdx];
            // Clear current line
            while (currentLineRef.current.length > 0) {
              term.write("\b \b");
              currentLineRef.current = currentLineRef.current.slice(0, -1);
            }
            currentLineRef.current = target;
            term.write(target);
          }
          return;
        }

        // Arrow Down (history)
        if (data === "\x1b[B") {
          if (historyIdxRef.current !== -1) {
            const nextIdx = historyIdxRef.current + 1;
            if (nextIdx >= historyRef.current.length) {
              historyIdxRef.current = -1;
              while (currentLineRef.current.length > 0) {
                term.write("\b \b");
                currentLineRef.current = currentLineRef.current.slice(0, -1);
              }
            } else {
              historyIdxRef.current = nextIdx;
              const target = historyRef.current[nextIdx];
              while (currentLineRef.current.length > 0) {
                term.write("\b \b");
                currentLineRef.current = currentLineRef.current.slice(0, -1);
              }
              currentLineRef.current = target;
              term.write(target);
            }
          }
          return;
        }

        // Printable char
        if (data >= " " || data === "\t") {
          currentLineRef.current += data;
          term.write(data);
        }
      });
    }

    // Fit on open or maximize
    const timer = setTimeout(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [isOpen, activeCwd]);

  useEffect(() => {
    try {
      fitAddonRef.current?.fit();
    } catch {
      // ignore
    }
  }, [maximized]);

  const executeCommand = async (command: string, term: Terminal) => {
    if (command === "clear" || command === "cls") {
      term.clear();
      printPrompt(term);
      return;
    }

    runningRef.current = true;
    term.writeln("");
    try {
      const res = await fetch("/api/universal/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: activeCwd, command }),
      });

      if (!res.ok || !res.body) {
        term.writeln(`\x1b[31m[执行失败: HTTP ${res.status}]\x1b[0m`);
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          // Normalize newlines for xterm
          term.write(text.replace(/\r?\n/g, "\r\n"));
        }
      }
    } catch (err: any) {
      term.writeln(`\x1b[31m[错误: ${err.message}]\x1b[0m`);
    } finally {
      runningRef.current = false;
      printPrompt(term);
    }
  };

  const handleClear = () => {
    if (termRef.current) {
      termRef.current.clear();
      printPrompt(termRef.current);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed left-0 right-0 bottom-0 z-40 bg-card/95 border-t border-border shadow-2xl flex flex-col transition-all duration-200 backdrop-blur-md ${
        maximized ? "h-[75vh]" : "h-64 sm:h-72"
      }`}
    >
      {/* Terminal Title Bar */}
      <div className="h-9 px-4 border-b border-border/70 flex items-center justify-between text-xs bg-muted/40 select-none">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <TerminalIcon className="w-3.5 h-3.5 text-primary" />
          <span>终端 (Terminal)</span>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono bg-muted/60 px-2 py-0.5 rounded border border-border/50 max-w-[300px] truncate">
            <Folder className="w-3 h-3 shrink-0" />
            <span className="truncate">{activeCwd}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-muted-foreground">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleClear}
            className="h-6 px-1.5 text-[11px] gap-1 hover:text-foreground"
            title="清屏 (Ctrl+L / clear)"
          >
            <Trash2 className="w-3 h-3" />
            <span className="hidden sm:inline">清屏</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMaximized(!maximized)}
            className="h-6 w-6 p-0 hover:text-foreground"
            title={maximized ? "还原高度" : "最大化"}
          >
            {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="h-6 w-6 p-0 hover:text-destructive"
            title="收起终端 (快捷键 Ctrl+`)"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Terminal Body */}
      <div className="flex-1 p-2 bg-[#0b0e14] overflow-hidden" ref={containerRef} />
    </div>
  );
};
