import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Terminal as TerminalIcon, X, Maximize2, Minimize2, Trash2, Folder, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspaceDefaultQuery } from "@/lib/acp-queries";
import { useStudioStore } from "@/stores/useStudioStore";

/** 终端输出写屏上限：超长只保留前 128KB 并注明，避免巨量输出卡死 xterm。 */
export const TERMINAL_OUTPUT_CAP = 131072;

/**
 * 输出截断（纯函数，可测）：决定本块写多少、是否已触顶。
 * 调用方触顶后应 cancel reader 并打印截断提示。
 */
export function applyTerminalCap(
  written: number,
  chunk: string,
  cap: number = TERMINAL_OUTPUT_CAP
): { write: string; capped: boolean } {
  if (written >= cap) return { write: "", capped: true };
  if (written + chunk.length > cap) return { write: chunk.slice(0, cap - written), capped: true };
  return { write: chunk, capped: false };
}

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
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const currentLineRef = useRef("");
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  // 聊天卡片“在终端中打开”预填的命令（只填行、不执行，消费后清零）。
  const prefill = useStudioStore((s) => s.terminalPrefill);

  // NOTE: xterm is intentionally statically imported here and nowhere else
  // (verified: only this file references @xterm/*). App.tsx lazy-loads this
  // drawer, so xterm lands in its own on-demand chunk (manualChunks "xterm").

  /**
   * Resolve the working directory without any hardcoded personal path.
   * Priority: explicit `cwd` prop (App passes the active workspace/session
   * cwd) -> last workspace persisted in localStorage -> server default
   * (/api/universal/workspace/default) -> "" with a placeholder prompting
   * the user to pick a directory (Ctrl+O). Frontend has no process.cwd().
   */
  const [resolvedCwd, setResolvedCwd] = useState<string>(() => {
    if (cwd) return cwd;
    try {
      const last = localStorage.getItem("acp_current_workspace");
      if (last && last.trim()) return last.trim();
    } catch {
      // ignore storage errors, fall through to server default
    }
    return "";
  });

  useEffect(() => {
    if (cwd) {
      setResolvedCwd(cwd);
    }
  }, [cwd]);

  // Shared cached default (same query key as App): no duplicate fetch.
  const workspaceDefaultQuery = useWorkspaceDefaultQuery(!cwd && !resolvedCwd);
  useEffect(() => {
    const path = workspaceDefaultQuery.data?.path;
    if (path && !cwd && !resolvedCwd) setResolvedCwd(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceDefaultQuery.data]);

  const activeCwd = resolvedCwd;
  const hasCwd = activeCwd.trim().length > 0;

  const printPrompt = (t: Terminal) => {
    const short = hasCwd
      ? activeCwd.split(/[/\\]/).filter(Boolean).pop() || activeCwd
      : "（未选择目录）";
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
      if (hasCwd) {
        term.writeln(`\x1b[90m工作目录:\x1b[0m \x1b[33m${activeCwd}\x1b[0m`);
      } else {
        term.writeln("\x1b[33m[未选择工作目录]\x1b[0m \x1b[90m按 Ctrl+O 选择目录，或等待默认工作区加载\x1b[0m");
      }
      term.writeln("\x1b[90m支持 PowerShell / 命令执行，按 Enter 运行，支持快捷键 Ctrl+` 开关\x1b[0m");
      printPrompt(term);

      // Handle key input
      term.onData((data) => {
        // 运行中只响应 Ctrl+C（取消），其余输入丢弃防交错
        if (runningRef.current) {
          if (data === "\x03") handleCancel();
          return;
        }

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

  const handleCancel = () => {
    abortRef.current?.abort();
    readerRef.current?.cancel().catch(() => {});
  };

  const executeCommand = async (command: string, term: Terminal) => {
    if (command === "clear" || command === "cls") {
      term.clear();
      printPrompt(term);
      return;
    }

    if (!hasCwd) {
      term.writeln("");
      term.writeln("\x1b[33m[未选择工作目录]\x1b[0m \x1b[90m请先按 Ctrl+O 选择目录后再执行命令\x1b[0m");
      printPrompt(term);
      return;
    }

    runningRef.current = true;
    setRunning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    term.writeln("");
    let written = 0;
    try {
      const res = await fetch("/api/universal/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: activeCwd, command }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        term.writeln(`\x1b[31m[执行失败: HTTP ${res.status}]\x1b[0m`);
      } else {
        const reader = res.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (ctrl.signal.aborted) break;
          const text = decoder.decode(value, { stream: true });
          // Normalize newlines for xterm
          const normalized = text.replace(/\r?\n/g, "\r\n");
          const { write, capped } = applyTerminalCap(written, normalized);
          if (write) {
            term.write(write);
            written += write.length;
          }
          if (capped) {
            term.writeln("\r\n\x1b[33m[输出超长，已截断，只保留前 128KB]\x1b[0m");
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            break;
          }
        }
      }
    } catch (err: any) {
      if (ctrl.signal.aborted || err?.name === "AbortError") {
        term.writeln("\x1b[33m[已取消]\x1b[0m");
      } else {
        console.error("[TerminalDrawer] command exec failed:", err);
        term.writeln(`\x1b[31m[错误: ${err.message}]\x1b[0m`);
      }
    } finally {
      readerRef.current = null;
      abortRef.current = null;
      runningRef.current = false;
      setRunning(false);
      printPrompt(term);
    }
  };

  // 聊天卡片“在终端中打开”：预填命令到当前行，绝不自动执行。
  // 抽屉刚打开时终端可能还没建好（同一 effect 内创建），轮询等就绪；
  // 若有命令正在跑则保留 prefill，等下一轮就绪再填（3s 上限）。
  useEffect(() => {
    if (!isOpen || !prefill) return;
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      const term = termRef.current;
      if (term && !runningRef.current) {
        while (currentLineRef.current.length > 0) {
          term.write("\b \b");
          currentLineRef.current = currentLineRef.current.slice(0, -1);
        }
        currentLineRef.current = prefill;
        term.write(prefill);
        useStudioStore.getState().setTerminalPrefill(null);
        return;
      }
      if (++tries < 30) setTimeout(attempt, 100);
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [isOpen, prefill]);

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
            <span className="truncate" title={hasCwd ? activeCwd : "未选择工作目录，按 Ctrl+O 选择"}>
              {hasCwd ? activeCwd : "未选择工作目录（Ctrl+O 选择）"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-muted-foreground">
          {running && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              className="h-6 px-1.5 text-[11px] gap-1 text-destructive hover:text-destructive"
              title="取消当前命令 (Ctrl+C)"
            >
              <Square className="w-3 h-3 fill-current" />
              <span className="hidden sm:inline">停止</span>
            </Button>
          )}
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
