import React, { useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { Terminal as TerminalIcon, X, Maximize2, Minimize2, Trash2, Folder, Square, Search, ChevronUp, ChevronDown, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspaceDefaultQuery } from "@/lib/acp-queries";
import { useStudioStore } from "@/stores/useStudioStore";
import { ptyStatus, ptyResize, ptyWsCandidateBases, buildPtyWsUrl } from "@/lib/universal-api";
import { apiFetch, withTokenQuery } from "@/lib/gateway-auth";

/** 抽屉传输模式：pty=真交互 shell；oneshot=单次执行（PTY 不可用时回落）。 */
export type TerminalMode = "probing" | "pty" | "oneshot";

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

/** xterm 配色所需的主题通道（读自 :root 计算样式，随 data-theme 切换）。 */
export interface TerminalCssVars {
  background: string;
  card: string;
  cardForeground: string;
  primary: string;
}

/** 读主题变量；非浏览器/DOM 缺省时回退深色默认（happy-dom 单测走此分支）。 */
export function readTerminalCssVars(): TerminalCssVars {
  const fallback: TerminalCssVars = {
    background: "#0b0e14",
    card: "#11151d",
    cardForeground: "#e2e8f0",
    primary: "#38bdf8",
  };
  try {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name: string, fb: string) => {
      const v = cs.getPropertyValue(name).trim();
      return v ? `hsl(${v})` : fb;
    };
    return {
      background: pick("--background", fallback.background),
      card: pick("--card", fallback.card),
      cardForeground: pick("--card-foreground", fallback.cardForeground),
      primary: pick("--primary", fallback.primary),
    };
  } catch {
    return fallback;
  }
}

/** 只有 light 主题是浅色（见 useThemeStore.THEMES），其余 dark/oled/dim 皆深色。 */
export function isLightTerminalTheme(): boolean {
  try {
    return document.documentElement.getAttribute("data-theme") === "light";
  } catch {
    return false;
  }
}

/**
 * 主题感知 xterm 配色（纯函数，可测）：底/字/光标跟随主题卡片，
 * ANSI 语义色在浅色下压暗保对比（尤其 black/white 必须对调，否则白底看不见）。
 */
export function buildXtermTheme(vars: TerminalCssVars, light: boolean): ITheme {
  return {
    background: vars.card,
    foreground: vars.cardForeground,
    cursor: vars.primary,
    cursorAccent: vars.card,
    selectionBackground: light ? "rgba(37, 99, 235, 0.25)" : "rgba(56, 189, 248, 0.3)",
    black: light ? "#64748b" : "#1e293b",
    red: light ? "#dc2626" : "#f87171",
    green: light ? "#16a34a" : "#4ade80",
    yellow: light ? "#a16207" : "#facc15",
    blue: light ? "#2563eb" : "#60a5fa",
    magenta: light ? "#9333ea" : "#c084fc",
    cyan: light ? "#0891b2" : "#38bdf8",
    white: light ? "#1e293b" : "#f8fafc",
  };
}

export interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cwd: string | null;
}

/**
 * 导出文件名（纯函数，可测）：terminal-<目录短名>-<时间戳>.log。
 */
export function buildTerminalExportFilename(cwd: string, now: number = Date.now()): string {
  const short = (cwd.split(/[/\\]/).filter(Boolean).pop() || "terminal").replace(/[^\w\-一-鿿]+/g, "_");
  return `terminal-${short}-${now}.log`;
}

/** 浮动终端几何（纯函数，可测；组件只负责指针事件接线）。 */
export interface TerminalGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TERMINAL_MIN_W = 380;
export const TERMINAL_MIN_H = 200;
const TERMINAL_GEOM_KEY = "acp_terminal_geom";

export function defaultTerminalGeom(vw: number, vh: number): TerminalGeom {
  const w = Math.min(720, Math.max(TERMINAL_MIN_W, vw - 32));
  const h = Math.min(340, Math.max(TERMINAL_MIN_H, vh - 200));
  return { w, h, x: Math.max(8, vw - w - 16), y: Math.max(8, vh - h - 16) };
}

export function clampTerminalGeom(g: TerminalGeom, vw: number, vh: number): TerminalGeom {
  const w = Math.min(Math.max(Math.round(g.w), TERMINAL_MIN_W), Math.max(TERMINAL_MIN_W, vw - 16));
  const h = Math.min(Math.max(Math.round(g.h), TERMINAL_MIN_H), Math.max(TERMINAL_MIN_H, vh - 16));
  return {
    w,
    h,
    x: Math.min(Math.max(Math.round(g.x), 8 - w + 120), Math.max(8, vw - 80)),
    y: Math.min(Math.max(Math.round(g.y), 8), Math.max(8, vh - 60)),
  };
}

export function moveTerminalGeom(g: TerminalGeom, dx: number, dy: number, vw: number, vh: number): TerminalGeom {
  return clampTerminalGeom({ ...g, x: g.x + dx, y: g.y + dy }, vw, vh);
}

export type TerminalResizeDir = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export function resizeTerminalGeom(
  g: TerminalGeom,
  dir: TerminalResizeDir,
  dx: number,
  dy: number,
  vw: number,
  vh: number
): TerminalGeom {
  let { x, y, w, h } = g;
  if (dir.includes("e")) w += dx;
  if (dir.includes("s")) h += dy;
  if (dir.includes("w")) {
    x += dx;
    w -= dx;
  }
  if (dir.includes("n")) {
    y += dy;
    h -= dy;
  }
  // 西/北边触最小尺寸时固定对侧边（x/y 回退多余位移）。
  if (w < TERMINAL_MIN_W && dir.includes("w")) x -= TERMINAL_MIN_W - w;
  if (h < TERMINAL_MIN_H && dir.includes("n")) y -= TERMINAL_MIN_H - h;
  return clampTerminalGeom({ x, y, w, h }, vw, vh);
}

function loadTerminalGeom(): TerminalGeom | null {
  try {
    const raw = localStorage.getItem(TERMINAL_GEOM_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Partial<TerminalGeom>;
    if (
      typeof g.x !== "number" ||
      typeof g.y !== "number" ||
      typeof g.w !== "number" ||
      typeof g.h !== "number"
    ) {
      return null;
    }
    return { x: g.x, y: g.y, w: g.w, h: g.h };
  } catch {
    return null;
  }
}

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({ isOpen, onClose, cwd }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchCount, setSearchCount] = useState(0);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  // 传输模式：pty 优先，status 不可用/WS 全败即回落 oneshot（Bun dev）。
  const [mode, setModeState] = useState<TerminalMode>("probing");
  const modeRef = useRef<TerminalMode>("probing");
  const [ptyDead, setPtyDead] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const ptyIdRef = useRef<string>("");
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setMode = (m: TerminalMode) => {
    modeRef.current = m;
    setModeState(m);
  };
  const [geom, setGeom] = useState<TerminalGeom | null>(null);
  // 拖拽会话（pointer down 时快照，move 时按增量换算，避免闭包过期）。
  const dragRef = useRef<{
    mode: "move" | TerminalResizeDir;
    startX: number;
    startY: number;
    orig: TerminalGeom;
  } | null>(null);
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
    // 浅色下青色对比不足，改用蓝色；深色保持青色。
    const accent = isLightTerminalTheme() ? "\x1b[34m" : "\x1b[36m";
    t.write(`\r\n${accent}PS ${short}\x1b[0m\x1b[90m>\x1b[0m `);
  };

  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    if (!termRef.current) {
      const vars = readTerminalCssVars();
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.25,
        scrollback: 5000,
        theme: buildXtermTheme(vars, isLightTerminalTheme()),
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      // 链接可点（输出里的 URL/文件路径直接打开）
      term.loadAddon(new WebLinksAddon());
      // CJK/emoji 列宽按 unicode11（中文输出不对齐的根治）
      const unicode11 = new Unicode11Addon();
      term.loadAddon(unicode11);
      term.unicode.activeVersion = "11";
      // 回滚搜索（Ctrl+F 搜索条）
      const search = new SearchAddon();
      term.loadAddon(search);
      searchAddonRef.current = search;
      try {
        search.onDidChangeResults((e) => setSearchCount(e.resultCount));
      } catch {
        // 旧版 addon 无此事件：计数保持 0，只上下跳转
      }
      // 回滚导出（.log 下载）
      const serialize = new SerializeAddon();
      term.loadAddon(serialize);
      serializeAddonRef.current = serialize;
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
        // PTY 模式：全量透传给 shell（它自己回显；Ctrl+C 即 \x03 即 SIGINT）。
        if (modeRef.current === "pty") {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
          return;
        }
        // 运行中只响应 Ctrl+C（取消），其余输入丢弃防交错
        if (runningRef.current) {
          if (data === "\x03") handleCancel();
          return;
        }

        // Ctrl+F 搜索回滚 / Ctrl+L 清屏
        if (data === "\x06") {
          setSearchOpen(true);
          return;
        }
        if (data === "\x0c") {
          handleClear();
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

  // 主题切换时热更新 xterm 配色（不重建终端，输入行/历史保留）。
  useEffect(() => {
    if (!isOpen) return;
    const apply = () => {
      const term = termRef.current;
      if (term) term.options.theme = buildXtermTheme(readTerminalCssVars(), isLightTerminalTheme());
    };
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    return () => mo.disconnect();
  }, [isOpen]);
  // 首次打开时初始化几何：localStorage 优先，校验后按视口钳制。
  useEffect(() => {
    if (!isOpen) return;
    setGeom((prev) => {
      if (prev) return clampTerminalGeom(prev, window.innerWidth, window.innerHeight);
      const stored = loadTerminalGeom();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (stored) return clampTerminalGeom(stored, vw, vh);
      return defaultTerminalGeom(vw, vh);
    });
  }, [isOpen]);

  // 几何持久化（拖拽每帧写 localStorage 成本可忽略，失败静默）。
  useEffect(() => {
    if (!geom) return;
    try {
      localStorage.setItem(TERMINAL_GEOM_KEY, JSON.stringify(geom));
    } catch {
      // ignore storage errors
    }
  }, [geom]);

  // 视口变化时把面板钳回可见区。
  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => {
      setGeom((prev) => (prev ? clampTerminalGeom(prev, window.innerWidth, window.innerHeight) : prev));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen]);

  // 拖拽/缩放走 window 级监听：pointer capture 在标题栏按钮上易丢，冒泡更稳。
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setGeom(d.mode === "move" ? moveTerminalGeom(d.orig, dx, dy, vw, vh) : resizeTerminalGeom(d.orig, d.mode, dx, dy, vw, vh));
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  const beginDrag = (e: React.PointerEvent, mode: "move" | TerminalResizeDir) => {
    if (maximized || e.button !== 0) return;
    const cur = geom;
    if (!cur) return;
    e.preventDefault();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, orig: cur };
    setDragging(true);
  };

  useEffect(() => {
    // 打开/几何变化后重排 xterm 列数（双 rAF 等布局落定）。
    let raf = 0;
    const fit = () => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
    };
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(fit);
    });
    // 列数变化同步给 pty（debounced；oneshot 下空转）。
    notifyPtyResize();
    return () => cancelAnimationFrame(raf);
  }, [maximized, geom, isOpen, searchOpen]);

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
      const res = await apiFetch("/api/universal/terminal/exec", {
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
        // PTY 模式：把命令“打”进 shell 行，不带回车，绝不自动执行。
        if (modeRef.current === "pty") {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(prefill);
            useStudioStore.getState().setTerminalPrefill(null);
            return;
          }
        } else if (modeRef.current === "oneshot") {
          while (currentLineRef.current.length > 0) {
            term.write("\b \b");
            currentLineRef.current = currentLineRef.current.slice(0, -1);
          }
          currentLineRef.current = prefill;
          term.write(prefill);
          useStudioStore.getState().setTerminalPrefill(null);
          return;
        }
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

  // 搜索条：输入即跳首个命中；关闭时清高亮。
  useEffect(() => {
    const addon = searchAddonRef.current;
    if (!addon || !termRef.current) return;
    if (!searchOpen || !searchText) {
      try {
        addon.clearActiveDecoration();
      } catch {
        // 旧版 addon 无此 API：忽略
      }
      return;
    }
    addon.findNext(searchText);
  }, [searchOpen, searchText]);

  const handleExport = () => {
    const addon = serializeAddonRef.current;
    if (!addon) return;
    const blob = new Blob([addon.serialize()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildTerminalExportFilename(activeCwd);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const note = (text: string) => {
    termRef.current?.writeln(`\r\n\x1b[90m${text}\x1b[0m`);
  };

  const closePty = () => {
    const ws = wsRef.current;
    wsRef.current = null;
    try {
      ws?.close();
    } catch {
      // 关闭中：忽略
    }
  };

  const enterOneshotFallback = (reason: string | null) => {
    closePty();
    setMode("oneshot");
    if (reason) note(`[真 PTY 不可用：${reason}，已回落单次执行模式]`);
    if (termRef.current && !runningRef.current) printPrompt(termRef.current);
  };

  // PTY 连接：候选基址逐个试（同源 → 回环直连），全败即回落 oneshot。
  // 每次连接用新 ptyId；服务端同 id 重入会先杀旧会话，天然防重影。
  const connectPty = () => {
    const term = termRef.current;
    if (!term) return;
    if (!hasCwd) {
      enterOneshotFallback("未选择工作目录");
      return;
    }
    ptyIdRef.current = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ptyId = ptyIdRef.current;
    const bases = ptyWsCandidateBases(window.location.host, window.location.protocol);
    setPtyDead(false);
    const attempt = (i: number) => {
      if (i >= bases.length) {
        enterOneshotFallback("PTY 连接失败");
        return;
      }
      let settled = false;
      const ws = new WebSocket(withTokenQuery(buildPtyWsUrl(bases[i], ptyId, activeCwd, 80, 24)));
      ws.onopen = () => {
        settled = true;
        wsRef.current = ws;
        setMode("pty");
        setPtyDead(false);
        notifyPtyResize();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") termRef.current?.write(ev.data);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {
            // 忽略
          }
          attempt(i + 1);
        }
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          attempt(i + 1);
          return;
        }
        // 建连后的断开：shell 退出或网关重启 → 显式重连入口，不静默重生
        //（自动重生会丢 shell 状态还让人困惑，loud 原则）。
        if (wsRef.current === ws) {
          wsRef.current = null;
          setPtyDead(true);
          note("[PTY 连接断开，点标题栏重连恢复]");
        }
      };
    };
    attempt(0);
  };

  // 列数同步（fit 后调，debounced；未知会话 404 即忽略，由重连恢复）。
  const notifyPtyResize = () => {
    if (modeRef.current !== "pty" || !ptyIdRef.current) return;
    const term = termRef.current;
    const fit = fitAddonRef.current;
    if (!term || !fit) return;
    let dims: { cols: number; rows: number } | undefined;
    try {
      dims = fit.proposeDimensions() as { cols: number; rows: number } | undefined;
    } catch {
      return;
    }
    if (!dims?.cols || !dims?.rows) return;
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      ptyResize(ptyIdRef.current, dims.cols, dims.rows).catch(() => {});
    }, 300);
  };

  // 打开即探活：PTY 可用走 WS，不可用（Bun dev）回落单次；关闭即断 WS。
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setMode("probing");
    setPtyDead(false);
    ptyStatus()
      .then((st) => {
        if (cancelled) return;
        if (st.available) connectPty();
        else enterOneshotFallback(st.reason);
      })
      .catch(() => {
        if (!cancelled) enterOneshotFallback("网关不可达");
      });
    return () => {
      cancelled = true;
      closePty();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  // 最大化：占视口主体（留边），禁用拖拽/缩放。
  const panelStyle: React.CSSProperties = maximized
    ? { left: 16, right: 16, top: 16, bottom: 16 }
    : geom
      ? { left: geom.x, top: geom.y, width: geom.w, height: geom.h }
      : { right: 16, bottom: 16, width: 640, height: 340 };

  const resizeHandle = (dir: TerminalResizeDir, className: string, cursor: string) => (
    <div
      onPointerDown={(e) => beginDrag(e, dir)}
      className={`absolute z-10 touch-none ${className}`}
      style={{ cursor }}
    />
  );

  return (
    <div
      className="fixed z-40 bg-card/95 border border-border rounded-xl shadow-2xl flex flex-col backdrop-blur-md overflow-hidden"
      style={panelStyle}
    >
      {/* Terminal Title Bar（拖拽手柄；按钮区 stopPropagation 不触发拖动） */}
      <div
        className={`h-9 px-3 border-b border-border/70 flex items-center justify-between text-xs bg-muted/40 select-none shrink-0 ${maximized ? "" : dragging ? "cursor-grabbing touch-none" : "cursor-move touch-none"}`}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          beginDrag(e, "move");
        }}
      >
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <TerminalIcon className="w-3.5 h-3.5 text-primary" />
          <span>终端 (Terminal)</span>
          {/* 传输模式徽标：诚实展示当前是真 shell 还是回落 */}
          <span
            className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${
              mode === "pty"
                ? "text-success border-success/40 bg-success/10"
                : mode === "oneshot"
                  ? "text-warning border-warning/40 bg-warning/10"
                  : "text-muted-foreground border-border/60 bg-muted/40"
            }`}
            title={mode === "pty" ? "真 PTY 交互 shell" : mode === "oneshot" ? "单次执行回落（真 PTY 不可用）" : "正在探测真 PTY…"}
          >
            {mode === "pty" ? "PTY" : mode === "oneshot" ? "单次" : "…"}
          </span>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono bg-muted/60 px-2 py-0.5 rounded border border-border/50 max-w-[300px] truncate">
            <Folder className="w-3 h-3 shrink-0" />
            <span className="truncate" title={hasCwd ? activeCwd : "未选择工作目录，按 Ctrl+O 选择"}>
              {hasCwd ? activeCwd : "未选择工作目录（Ctrl+O 选择）"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-muted-foreground">
          {ptyDead && mode === "pty" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => connectPty()}
              className="h-6 px-1.5 text-[11px] gap-1 text-primary hover:text-primary"
              title="重建 PTY 会话并重连（旧 shell 状态不保留）"
            >
              <RefreshCw className="w-3 h-3" />
              <span className="hidden sm:inline">重连</span>
            </Button>
          )}
          {(running || (mode === "pty" && !ptyDead)) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // PTY 下停止 = 发 SIGINT（\x03），与终端里按 Ctrl+C 等价
                if (modeRef.current === "pty") {
                  const ws = wsRef.current;
                  if (ws && ws.readyState === WebSocket.OPEN) ws.send("\x03");
                } else {
                  handleCancel();
                }
              }}
              className="h-6 px-1.5 text-[11px] gap-1 text-destructive hover:text-destructive"
              title={mode === "pty" ? "发送 Ctrl+C 中断前台程序" : "取消当前命令 (Ctrl+C)"}
            >
              <Square className="w-3 h-3 fill-current" />
              <span className="hidden sm:inline">停止</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSearchOpen((v) => !v)}
            className={`h-6 w-6 p-0 ${searchOpen ? "text-foreground bg-muted" : "hover:text-foreground"}`}
            title="搜索回滚 (Ctrl+F)"
          >
            <Search className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleExport}
            className="h-6 w-6 p-0 hover:text-foreground"
            title="导出回滚为 .log"
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
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

      {/* 搜索条 */}
      {searchOpen && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/70 bg-muted/40 text-xs shrink-0">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) searchAddonRef.current?.findPrevious(searchText);
                else searchAddonRef.current?.findNext(searchText);
              } else if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchText("");
              }
            }}
            placeholder="搜索回滚… Enter 下一个 · Shift+Enter 上一个 · Esc 关闭"
            className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/60 text-foreground"
          />
          {searchText && (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
              {searchCount > 0 ? `${searchCount} 命中` : "无命中"}
            </span>
          )}
          <button
            type="button"
            onClick={() => searchAddonRef.current?.findPrevious(searchText)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="上一个 (Shift+Enter)"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => searchAddonRef.current?.findNext(searchText)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="下一个 (Enter)"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setSearchText("");
            }}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
            title="关闭 (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Terminal Body（底色跟主题卡片走，xterm 画布同色无接缝） */}
      <div className="flex-1 p-2 bg-card overflow-hidden" ref={containerRef} />

      {/* 八向缩放手柄（最大化时隐藏；拖拽中保持命中） */}
      {!maximized && (
        <>
          {resizeHandle("n", "left-2 right-2 top-0 h-1.5", "ns-resize")}
          {resizeHandle("s", "left-2 right-2 bottom-0 h-1.5", "ns-resize")}
          {resizeHandle("w", "top-2 bottom-2 left-0 w-1.5", "ew-resize")}
          {resizeHandle("e", "top-2 bottom-2 right-0 w-1.5", "ew-resize")}
          {resizeHandle("nw", "left-0 top-0 w-3 h-3", "nwse-resize")}
          {resizeHandle("se", "right-0 bottom-0 w-3 h-3", "nwse-resize")}
          {resizeHandle("ne", "right-0 top-0 w-3 h-3", "nesw-resize")}
          {resizeHandle("sw", "left-0 bottom-0 w-3 h-3", "nesw-resize")}
        </>
      )}
    </div>
  );
};
