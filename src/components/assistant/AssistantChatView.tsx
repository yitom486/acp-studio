import React from "react";
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDown,
  ArrowRight,
  CornerDownLeft,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  History,
  Pencil,
  RefreshCw,
  Bot,
  User,
  Wrench,
  Info,
  SquareTerminal,
  Terminal,
  FileText,
  PencilLine,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AcpMarkdownText } from "@/components/assistant/AcpMarkdown";
import { AcpImagePart } from "@/components/assistant/AcpMedia";
import { TurnChanges } from "@/components/assistant/TurnChanges";
import { TurnDiffViewer } from "@/components/assistant/TurnDiffViewer";
import {
  DiffButton,
  FileEditCard,
  FileReadCard,
  InlineApproval,
  LiveElapsed,
  SearchCard,
  StatusDot,
  TerminalCard,
  type WidgetTool,
} from "@/components/assistant/AcpToolWidgets";
import {
  isGenerativeTool,
  AcpGenerativeToolCard,
} from "@/components/assistant/toolkit";
import {
  extractFileFromTool,
  fmtElapsed,
  resolveToolDisplayTitle,
  resolveWidgetKey,
  toolPath,
  toolCommand,
  toolText,
  firstLines,
  strField,
} from "@/components/assistant/tool-widget-utils";
import type { Message } from "@/lib/message-types";
import { partitionTurnContent } from "@/lib/threads";
import type { UsageState } from "@/stores/useStudioStore";
import { useStudioStore } from "@/stores/useStudioStore";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { cn } from "@/lib/utils";
import { MessageScroller } from "@/components/primitives/MessageScroller";
import { ActionSwap, MagneticButton } from "@/components/atoms/MotionButtons";
import { Citations, type CitationItem } from "@/components/primitives/Citations";
import { Loader } from "@/components/motion/Loader";

export interface AssistantChatViewProps {
  agentName?: string;
  onSelectSuggestion: (prompt: string) => void;
  onOpenDiff?: (filePath?: string | null) => void;
  /** 会话横幅：已连接但无活动会话时提示建会话/失败原因。 */
  connected?: boolean;
  sessionId?: string | null;
  sessionError?: string | null;
  sessionLoading?: boolean;
  onEnsureSession?: () => void;
  /** 当前工作区（本轮改动面板定位文件状态用）。 */
  cwd?: string | null;
}

// ---------- part renderers (Text 由 AcpMarkdownText 直供 primitive) ----------

/** 智能体首 Token 到达前的思考/等待指示器 (真实状态驱动，无编造步骤) */
const ThinkingStateCapsule: React.FC<{ startedAt?: number }> = ({ startedAt }) => {
  const [elapsed, setElapsed] = React.useState(() =>
    startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 100) / 10) : 0
  );
  const hasPendingPermission = useStudioStore((s) => s.pendingPerms.length > 0);
  const hasPendingElicitation = useStudioStore((s) => s.pendingElic.length > 0);

  React.useEffect(() => {
    if (hasPendingPermission || hasPendingElicitation) return;
    const start = startedAt || Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - start) / 100) / 10));
    }, 100);
    return () => clearInterval(timer);
  }, [startedAt, hasPendingPermission, hasPendingElicitation]);

  let label = `正在思考与分析意图… (${elapsed.toFixed(1)}s)`;
  let dotClass = "bg-primary animate-pulse";

  if (hasPendingPermission) {
    label = "等待用户确认授权…";
    dotClass = "bg-amber-500 animate-ping";
  } else if (hasPendingElicitation) {
    label = "等待用户回应提问…";
    dotClass = "bg-blue-500 animate-ping";
  }

  return (
    <div className="rounded-card border border-line bg-surface/90 px-3 py-1.5 shadow-card backdrop-blur-xs transition-all duration-300 w-fit max-w-sm flex items-center gap-2.5 text-[12px] text-ink-2 font-medium select-none">
      {hasPendingPermission ? (
        <span className="size-2 rounded-full shrink-0 bg-amber-500 animate-ping" />
      ) : hasPendingElicitation ? (
        <span className="size-2 rounded-full shrink-0 bg-blue-500 animate-ping" />
      ) : (
        <Loader variant="ascii-braille" size={13} className="text-primary font-bold shrink-0" />
      )}
      <span className="tabular-nums font-sans">{label}</span>
    </div>
  );
};

/**
 * 上下文用量面板：窗口占用 % + 进度条常显，点击展开本轮运行时明细。
 * 缓存命中率只有 agent 真下发 cachedTokens 时才出现，绝不编造。
 */
const UsagePanel: React.FC<{ msg: Message }> = ({ msg }) => {
  const [open, setOpen] = React.useState(false);
  const u = msg.usage as UsageState;
  const pct = u.size > 0 ? Math.min(1, u.used / u.size) : 0;
  const remain = Math.max(0, u.size - u.used);
  const bar = pct < 0.7 ? "bg-success" : pct < 0.9 ? "bg-warning" : "bg-destructive";
  const turnMs =
    msg.startedAt != null && msg.completedAt != null ? msg.completedAt - msg.startedAt : null;
  const thoughtMs =
    msg.thoughtTiming?.startedAt != null && msg.thoughtTiming.completedAt != null
      ? msg.thoughtTiming.completedAt - msg.thoughtTiming.startedAt
      : null;
  const doneTools = (msg.toolCalls || []).filter((t) => t.startedAt != null && t.completedAt != null);
  const toolMs = doneTools.reduce((a, t) => a + (t.completedAt! - t.startedAt!), 0);
  const cacheBase = u.totalTokens ?? u.used;
  const cacheRate =
    u.cachedTokens != null && cacheBase > 0 ? u.cachedTokens / cacheBase : null;
  const row = "flex items-center justify-between gap-2";
  return (
    <div className="rounded-lg bg-background/70 border border-border px-3 py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-left">
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span>
            context {u.used.toLocaleString()}/{u.size.toLocaleString()}
          </span>
          <span className="tabular-nums">{(pct * 100).toFixed(1)}%</span>
          {u.cost ? (
            <span>
              · ${u.cost.amount} {u.cost.currency}
            </span>
          ) : null}
          {cacheRate != null ? <span>· 缓存 {(cacheRate * 100).toFixed(1)}%</span> : null}
          <ChevronDown
            className={cn("w-3 h-3 ml-auto transition-transform duration-300", open && "rotate-180")}
          />
        </div>
        <div className="h-1 rounded-full bg-muted overflow-hidden mt-1.5">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", bar)}
            style={{ width: `${(pct * 100).toFixed(1)}%` }}
          />
        </div>
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 mt-1.5 border-t border-border/60 font-mono text-[10px] text-muted-foreground animate-fade-slide-in">
          <div className={row}><span>窗口总量</span><span className="tabular-nums">{u.size.toLocaleString()}</span></div>
          <div className={row}><span>剩余</span><span className="tabular-nums">{remain.toLocaleString()}</span></div>
          <div className={row}><span>本轮用时</span><span className="tabular-nums">{turnMs != null ? fmtElapsed(turnMs) : "—"}</span></div>
          <div className={row}><span>思考用时</span><span className="tabular-nums">{thoughtMs != null ? fmtElapsed(thoughtMs) : "—"}</span></div>
          <div className={row}>
            <span>工具调用</span>
            <span className="tabular-nums">{doneTools.length}/{(msg.toolCalls || []).length} · {fmtElapsed(toolMs)}</span>
          </div>
          {cacheRate != null ? (
            <div className={row}>
              <span>缓存命中</span>
              <span className="tabular-nums">{(cacheRate * 100).toFixed(1)}%（{u.cachedTokens!.toLocaleString()}/{cacheBase.toLocaleString()}）</span>
            </div>
          ) : (
            <div className={row}><span>缓存命中</span><span>agent 未提供</span></div>
          )}
          {u.inputTokens != null || u.outputTokens != null ? (
            <div className={cn(row, "col-span-2")}>
              <span>输入 / 输出</span>
              <span className="tabular-nums">{(u.inputTokens ?? 0).toLocaleString()} / {(u.outputTokens ?? 0).toLocaleString()}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
/**
 * 思维链 · 思考过程折叠卡（Beautiful UI 风格思维链）。
 * 运行时默认展开，完成后自动收起；用户手动切换后不再自动干预。
 */
const AcpReasoningView: React.FC<{
  thought: string;
  running: boolean;
  timing?: { startedAt?: number; completedAt?: number };
}> = ({ thought, running, timing }) => {
  const [open, setOpen] = React.useState(running);
  const manual = React.useRef(false);
  React.useEffect(() => {
    if (!manual.current) setOpen(running);
  }, [running]);
  if (!thought) return null;
  const doneMs =
    timing?.startedAt != null && timing.completedAt != null
      ? timing.completedAt - timing.startedAt
      : null;
  return (
    <div className="rounded-card bg-surface/85 border border-line text-xs text-ink-2 overflow-hidden shadow-xs transition-colors">
      <button
        type="button"
        onClick={() => {
          manual.current = true;
          setOpen((o) => !o);
        }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-hover-2 transition-colors cursor-pointer select-none"
      >
        <span className="flex shrink-0 text-ink-3">
          {running ? (
            <Loader variant="ascii-braille" size={13} className="text-primary font-bold shrink-0" />
          ) : (
            <Brain className="w-3.5 h-3.5" />
          )}
        </span>
        {running ? (
          <span
            className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
              backgroundSize: "200% 100%",
              animation: "shimmer-text 1.4s linear infinite",
            }}
          >
            思考中…
          </span>
        ) : (
          <span className="font-medium text-[13px] text-ink">
            思考过程
          </span>
        )}
        <span className="font-mono text-[10px] text-ink-3">({thought.length} 字)</span>
        {!running && doneMs != null && (
          <span className="font-mono text-[10px] text-ink-3">用时 {fmtElapsed(doneMs)}</span>
        )}
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("w-3.5 h-3.5 ml-auto transition-transform duration-300", open && "rotate-180")}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-0.5 ml-3 pl-3.5 pb-2.5 pt-0.5 border-l border-line text-[12.5px] leading-relaxed text-ink-2 font-sans break-words whitespace-pre-wrap">
            {thought}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * 阶段推进记录折叠组件（各时期中间态会话内容收拢容器）：
 * 流式推进期间可动态跟踪；运行完成或取消后自动收拢折叠，
 * 绝不与最终结论混杂，保证底部正文纯净，快速查看核心结论。
 */
const AgentProgressAccordion: React.FC<{
  progress: string;
  running?: boolean;
}> = React.memo(({ progress, running = false }) => {
  const [open, setOpen] = React.useState(running);
  const manual = React.useRef(false);
  const prevRunning = React.useRef(running);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    // 运行状态从非运行变为运行：自动展开
    if (running && !prevRunning.current) {
      manual.current = false;
      setOpen(true);
    }
    // 运行结束或取消：自动折叠收拢
    else if (!running && prevRunning.current) {
      if (!manual.current) {
        setOpen(false);
      }
    }
    prevRunning.current = running;
  }, [running]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(progress).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!progress || !progress.trim()) return null;
  const charCount = progress.trim().length;

  return (
    <div className="rounded-card bg-surface/85 border border-line text-xs text-ink-2 overflow-hidden shadow-xs transition-colors">
      <div className="w-full flex items-center justify-between px-3 py-2 hover:bg-hover-2 transition-colors">
        <button
          type="button"
          onClick={() => {
            manual.current = true;
            setOpen((o) => !o);
          }}
          className="flex-1 flex items-center gap-2 cursor-pointer select-none text-left min-w-0"
        >
          <span className="flex shrink-0 text-ink-3">
            {running ? (
              <Loader variant="ascii-braille" size={13} className="text-primary font-bold shrink-0" />
            ) : (
              <PencilLine className="w-3.5 h-3.5 text-primary" />
            )}
          </span>
          <span className="font-semibold text-ink text-[12.5px]">
            阶段推进记录 · {charCount} 字
          </span>
          {running ? (
            <span className="font-mono text-[10px] text-amber-500 font-medium flex items-center gap-1 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              正在推进…
            </span>
          ) : (
            <span className="font-mono text-[10px] text-muted-foreground ml-1">
              (已收拢)
            </span>
          )}
        </button>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="复制阶段过程记录"
          >
            {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={() => {
              manual.current = true;
              setOpen((o) => !o);
            }}
            className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title={open ? "收起" : "展开"}
          >
            <ChevronDown
              className={cn("w-3.5 h-3.5 text-ink-3 transition-transform duration-300 shrink-0", open && "rotate-180")}
            />
          </button>
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-1">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 max-h-[220px] overflow-y-auto overscroll-contain text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap break-words font-sans">
              {progress}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

type AcpToolCall = WidgetTool;

/** 单条工具行（含种类图标、Diff、终端打开、耗时、审批与折叠明细）。Memoized 避免无关流式更新时重复刷新。 */
const ToolCallRow: React.FC<{ tc: AcpToolCall }> = React.memo(({ tc }) => {
  const { kind = "", status } = tc;
  const displayTitle = resolveToolDisplayTitle(tc);
  const targetFile = extractFileFromTool(displayTitle) || toolPath(tc);
  const isFileTool =
    kind === "edit" || kind === "file" || kind === "diff" || !!targetFile;
  const active = status === "running" || status === "pending";
  const shortId = tc.id ? (tc.id.length > 12 ? `${tc.id.slice(0, 8)}…` : tc.id) : null;
  const widgetKey = resolveWidgetKey(tc);
  const cmd = toolCommand(tc);
  const isTerminal = widgetKey === "terminal" || !!cmd;

  const [expanded, setExpanded] = React.useState(false);
  const output = toolText(tc.rawOutput);
  const err = toolText(tc.rawError);
  const hasDetails = Boolean(output || err);

  const openInTerminal = () => {
    if (!cmd) return;
    const st = useStudioStore.getState();
    const toolCwd =
      strField(tc.rawInput, ["cwd", "workdir", "workDir", "dir", "directory"]) || null;
    st.setTerminalCwd(toolCwd);
    st.setTerminalPrefill(cmd);
    st.setTerminalOpen(true);
  };

  const cleanTitle =
    isFileTool && targetFile
      ? targetFile
      : isTerminal && cmd
        ? cmd
        : displayTitle;

  const toolVerb =
    widgetKey === "terminal"
      ? "执行"
      : widgetKey === "file-read"
        ? "读取"
        : widgetKey === "file-edit"
          ? "编辑"
          : widgetKey === "search"
            ? "检索"
            : "调用";

  return (
    <div className="rounded-control bg-surface border border-line text-xs text-ink-2 animate-fade-slide-in transition-colors">
      <div
        onClick={() => hasDetails && setExpanded((e) => !e)}
        className={cn(
          "flex items-center gap-2 px-2.5 h-[34px] select-none",
          hasDetails && "cursor-pointer hover:bg-hover-2",
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-3">
          {widgetKey === "terminal" ? (
            <Terminal className="w-3.5 h-3.5 text-accent" />
          ) : widgetKey === "file-read" ? (
            <FileText className="w-3.5 h-3.5 text-accent" />
          ) : widgetKey === "file-edit" ? (
            <PencilLine className="w-3.5 h-3.5 text-amber-500" />
          ) : widgetKey === "search" ? (
            <Search className="w-3.5 h-3.5 text-accent" />
          ) : (
            <Wrench className="w-3.5 h-3.5 text-accent" />
          )}
        </span>

        <span className="shrink-0 text-[11.5px] font-medium text-ink">
          {toolVerb}
        </span>

        {/* Beautiful UI styled inline chip */}
        <span
          className={cn(
            "inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-2 font-mono text-[11px] text-ink-2 shadow-hairline transition-colors hover:bg-hover-2",
            active && "animate-pulse"
          )}
          title={kind ? `${cleanTitle} [${kind}] (ID: ${tc.id})` : `${cleanTitle} (ID: ${tc.id})`}
        >
          {cleanTitle}
        </span>

        {shortId && (
          <span
            className="text-[10px] text-ink-3/60 hover:text-ink font-mono shrink-0 select-all cursor-default"
            title={`调用 ID: ${tc.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            {shortId}
          </span>
        )}

        <LiveElapsed startedAt={tc.startedAt} completedAt={tc.completedAt} />

        {isFileTool && (
          <span onClick={(e) => e.stopPropagation()}>
            <DiffButton file={targetFile} />
          </span>
        )}

        {isTerminal && cmd && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openInTerminal();
            }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-chip bg-field border border-line-strong hover:bg-hover-2 text-ink-2 text-[10px] font-sans transition-colors shrink-0 cursor-pointer"
            title="在终端中打开（只填入、不自动执行）"
          >
            <Terminal className="w-3 h-3" />
            <span>终端打开</span>
          </button>
        )}

        <StatusDot status={status} />

        {hasDetails && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
              "w-3 h-3 text-ink-3 transition-transform duration-200 shrink-0",
              expanded && "rotate-180",
            )}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </div>

      {expanded && (output || err) && (
        <div className="mx-1.5 mb-1.5 rounded-control border border-line bg-inset/70 overflow-hidden font-mono text-[11px] animate-fade-slide-in">
          {output && (
            <pre className="px-2.5 py-2 overflow-x-auto text-ink whitespace-pre-wrap break-words max-h-[160px]">
              <code>{firstLines(output, 10).shown}</code>
            </pre>
          )}
          {err && (
            <pre className="px-2.5 py-2 overflow-x-auto text-red whitespace-pre-wrap break-words max-h-[120px] border-t border-red/30">
              <code>{firstLines(err, 8).shown}</code>
            </pre>
          )}
        </div>
      )}
      <InlineApproval tc={tc} />
    </div>
  );
});

/** 统一使用规范单行工具组件，杜绝各卡片高度膨胀破坏 5 项视口滚动 */
const ToolWidget: React.FC<{ tc: AcpToolCall }> = ToolCallRow;

/**
 * 工具折叠组（Beautiful UI ToolChips 灵感与防布局扰动容器）：
 * 流式输出期间始终保持展开，绝不忽开忽关；流式结束或取消时自动折叠收起。
 * 内部滚动容器高度严格限制为 5 个工具项高度（max-h-[196px]），超出时在专门容器内向上平滑滚动，
 * 始终露出最新 5 个活跃工具，早期工具向上翻滚，杜绝破坏外部聊天正文排版，避免卡片剧烈忽大忽小；
 * 状态文案展示成功比例（如 67/68 成功），杜绝少量失败/重试引发恐慌。
 */
const AcpToolGroup: React.FC<{ tools: AcpToolCall[]; running?: boolean }> = React.memo(({ tools, running = false }) => {
  const activeTools = React.useMemo(
    () => tools.filter((t) => t.status === "running" || t.status === "pending"),
    [tools]
  );
  const failedTools = React.useMemo(
    () => tools.filter((t) => t.status === "failed"),
    [tools]
  );
  const anyActive = activeTools.length > 0;
  const total = tools.length;
  const failedCount = failedTools.length;
  const successCount = Math.max(0, total - failedCount);

  // 流式输出期间组件始终保持打开；若取消或流式结束再折叠
  const [open, setOpen] = React.useState(running);
  const manual = React.useRef(false);
  const prevRunning = React.useRef(running);

  // 内部滚动容器：限制最大高度为 5 个工具项（约 196px），新工具到达时自适应向上滚动
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const userScrolledUp = React.useRef(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 36;
    userScrolledUp.current = !isNearBottom;
  };

  React.useEffect(() => {
    // 状态从非运行跃迁到运行（新一轮流式开始）：重置手动干预与用户滚动标记，自动展开
    if (running && !prevRunning.current) {
      manual.current = false;
      userScrolledUp.current = false;
      if (tools.length > 0) {
        setOpen(true);
      }
    }
    // 流式输出期间：只要存在工具调用且用户未手动折叠，始终保持展开状态，绝不在单工具完成间歇期折叠
    else if (running && tools.length > 0) {
      if (!manual.current) {
        setOpen(true);
      }
    }
    // 流式输出结束或被用户取消（running 从 true 变为 false）：自动折叠收起
    else if (!running && prevRunning.current) {
      if (!manual.current) {
        setOpen(false);
      }
    }

    prevRunning.current = running;
  }, [running, tools.length]);

  // 工具列表更新或状态变化时，容器内平滑向上滚动，保持最新的 5 个工具可见
  React.useEffect(() => {
    if (open && scrollRef.current && !userScrolledUp.current) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el || userScrolledUp.current) return;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        el.scrollTo({
          top: el.scrollHeight,
          behavior: distance > 250 ? "auto" : "smooth",
        });
      });
    }
  }, [tools.length, anyActive, open]);

  const latest = activeTools.length > 0 ? activeTools[activeTools.length - 1] : null;
  if (!tools || tools.length === 0) return null;

  return (
    <div className="rounded-card bg-surface/85 border border-line overflow-hidden shadow-xs transition-colors">
      <button
        type="button"
        onClick={() => {
          manual.current = true;
          setOpen((o) => !o);
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-ink-2 hover:bg-hover-2 transition-colors cursor-pointer select-none"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-3">
          <Wrench className="w-3.5 h-3.5 text-accent" />
        </span>
        <span className="font-semibold text-ink text-[12.5px]">
          工具调用 · {total}
        </span>
        {latest ? (
          <span className="inline-flex items-center text-ink-2 text-[11px] truncate min-w-0 flex-1">
            正在调用 {resolveToolDisplayTitle(latest)}…
          </span>
        ) : failedCount > 0 ? (
          <span className="font-mono text-[10px] text-ink-3 flex items-center gap-1.5 ml-1">
            <span className={cn(successCount > 0 ? "text-amber-500 font-semibold" : "text-red font-semibold")}>
              {successCount}/{total} 成功
            </span>
            <span className="opacity-70">({failedCount} 次失败/重试)</span>
          </span>
        ) : (
          <span className="font-mono text-[10px] text-green font-medium ml-1">
            全部成功 ({total}/{total})
          </span>
        )}
        <span
          className={cn(
            "w-2 h-2 rounded-full shrink-0 ml-auto",
            anyActive
              ? "bg-amber-500 animate-pulse"
              : failedCount === 0
                ? "bg-green"
                : successCount > 0
                  ? "bg-amber-500"
                  : "bg-red",
          )}
          title={
            anyActive
              ? "正在执行工具"
              : failedCount === 0
                ? "全部工具调用成功"
                : `${total} 次调用中 ${successCount} 次成功，${failedCount} 次失败/重试`
          }
        />
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("w-3.5 h-3.5 transition-transform duration-300 shrink-0", open && "rotate-180")}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* 展开内容：高度严格限定为 5 个工具项（max-h-[196px]），在专门容器内向上平滑滚动 */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      >
        <div className="overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="px-2 pb-2 pt-0.5 space-y-1.5 max-h-[196px] overflow-y-auto overscroll-contain"
          >
            {tools.map((tc) => (
              <ToolWidget key={tc.id} tc={tc} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

// ---------- messages ----------

const SUGGESTIONS = [
  {
    title: "梳理这个仓库的结构",
    prompt: "请阅读当前工作区，说明关键目录和模块各自负责什么、入口在哪里、模块之间怎么调用。",
    hint: "只读",
  },
  {
    title: "审查未提交的改动",
    prompt: "请查看当前工作区未提交的改动（git diff），指出可能的 bug、边界情况和缺少的测试。",
    hint: "git diff",
  },
  {
    title: "为未提交的改动补测试",
    prompt: "请为当前工作区未提交的改动补充单元测试，并运行测试确认通过。",
    hint: "会写文件",
  },
  {
    title: "生成代码改进建议",
    prompt: "请通读当前核心代码，分析潜在的架构坏味道、性能瓶颈并给出重构建议。",
    hint: "架构分析",
  },
];

const AssistantWelcome: React.FC<{
  agentName: string;
  onSelectSuggestion: (prompt: string) => void;
  connected?: boolean;
  sessionId?: string | null;
  sessionError?: string | null;
  sessionLoading?: boolean;
  onEnsureSession?: () => void;
  cwd?: string | null;
}> = ({ agentName, onSelectSuggestion, connected, sessionId, sessionError, sessionLoading, onEnsureSession, cwd }) => (
  <div className="max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto pt-[10vh] pb-8 px-2 space-y-6">
    <div className="space-y-1.5 select-none">
      <h2 className="text-[22px] leading-tight font-semibold text-foreground tracking-[-0.01em]">
        {agentName}
      </h2>
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono min-w-0">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            connected ? "bg-success" : "bg-muted-foreground/50",
          )}
        />
        <span className="shrink-0">{connected ? "已连接" : "未连接"}</span>
        <span className="text-border">/</span>
        <span className="truncate" title={cwd || undefined}>{cwd || "未选择工作区"}</span>
      </div>
    </div>

    {connected && !sessionId && (
      <div
        className={cn(
          "rounded-md border px-3 py-2 text-xs",
          sessionError ? "border-warning/50 bg-warning/10" : "border-border bg-card",
        )}
      >
        <div className="flex items-center gap-2">
          {sessionLoading ? (
            <span className="inline-flex items-center text-muted-foreground text-xs">正在建立会话，模型列表马上就来…</span>
          ) : sessionError ? (
            <span className="text-warning font-medium">建会话失败：{sessionError}</span>
          ) : (
            <span className="text-muted-foreground">已连接，尚未建立会话</span>
          )}
          {!sessionLoading && (
            <button
              type="button"
              onClick={() => onEnsureSession?.()}
              className="ml-auto h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors shrink-0"
            >
              {sessionError ? "重试" : "建立会话"}
            </button>
          )}
        </div>
      </div>
    )}

    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-muted-foreground px-1">常用任务</div>
      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {SUGGESTIONS.map((item, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectSuggestion(item.prompt)}
            className="group w-full flex items-center gap-3 px-3 h-10 text-left text-[13px] text-foreground bg-card/40 hover:bg-accent transition-colors cursor-pointer"
            title={item.prompt}
          >
            <span className="flex-1 truncate">{item.title}</span>
            <span className="font-mono text-[11px] text-muted-foreground shrink-0">{item.hint}</span>
            <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        ))}
      </div>
    </div>
  </div>
);

const USER_MESSAGE_PARTS = {
  Text: AcpMarkdownText,
  Image: AcpImagePart,
};

const ASSISTANT_MESSAGE_PARTS = {
  Text: AcpMarkdownText,
  Reasoning: () => null,
  Image: AcpImagePart,
  tools: { Fallback: () => null },
};

/** 独立 Memoized 正文容器：隔绝思维链/工具组频繁重排与时间戳跳秒，保护已渲染正文稳定性 */
const AssistantMessageBody: React.FC = React.memo(() => (
  <div className="space-y-2">
    <MessagePrimitive.Parts components={ASSISTANT_MESSAGE_PARTS} />
  </div>
));

const UserMessageView: React.FC = () => {
  const messageId = useAuiState((s) => s.message.id);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);
  const acp = useStudioStore((s) => s.messages.find((m) => m.id === messageId));
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    const text = acp?.content || "";
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  if (isEditing) return <EditComposerView />;
  const threadRunning = useAuiState((s) => s.thread.isRunning);
  return (
    <MessagePrimitive.Root
      id={messageId}
      data-slot="message"
      data-message-id={messageId}
      data-from="user"
      className="flex gap-3 justify-end items-start group animate-fade-slide-in"
    >
      <div className="relative max-w-[80%]">
        <div
          data-slot="message-bubble-content"
          className="rounded-lg bg-secondary text-secondary-foreground px-3.5 py-2 break-words whitespace-pre-wrap text-sm leading-relaxed font-sans"
        >
          <MessagePrimitive.Parts components={USER_MESSAGE_PARTS} />
          {/* 底部 meta 单行：常驻挂载，只换透明度，宽高恒定不挤布局 */}
          <div className="flex items-center justify-end gap-0.5 pt-1.5">
            {acp?.timestamp && (
              <span className="text-[10px] font-mono text-muted-foreground/80 select-none mr-1">{acp.timestamp}</span>
            )}
            <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100 transition-opacity">
              <MagneticButton
                strength={0.2}
                onClick={copy}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                title="复制内容"
              >
                <ActionSwap stateKey={copied ? "copied" : "idle"}>
                  {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                </ActionSwap>
              </MagneticButton>
              <ActionBarPrimitive.Root className="flex items-center">
                <ActionBarPrimitive.Edit asChild>
                  <MagneticButton
                    strength={0.2}
                    disabled={threadRunning}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-40"
                    title="编辑后重发"
                  >
                    <Pencil className="w-3 h-3" />
                  </MagneticButton>
                </ActionBarPrimitive.Edit>
              </ActionBarPrimitive.Root>
            </span>
          </div>
        </div>
        <div className="flex justify-end">
          <BranchPickerView className="justify-end" />
        </div>
      </div>
      <div className="shrink-0 w-7 h-7 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground shadow-xs mt-0.5">
        <User className="w-4 h-4" />
      </div>
    </MessagePrimitive.Root>
  );
};

const EditComposerView: React.FC = () => {
  return (
    <MessagePrimitive.Root className="flex flex-col items-end [contain-intrinsic-size:auto_200px] [content-visibility:auto]">
      <ComposerPrimitive.Root className="flex w-full max-w-[80%] cursor-text flex-col rounded-2xl rounded-tr-xs border border-primary/40 bg-card transition-[border-color] ml-auto">
        <ComposerPrimitive.Input
          className="min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-foreground outline-none"
          autoFocus
        />
        <div className="mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 px-3">
              取消
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 px-3">
              更新
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPickerView: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
    >
      <BranchPickerPrimitive.Previous asChild>
        <button className="p-1 rounded hover:text-foreground transition-colors" title="上一分支">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </BranchPickerPrimitive.Previous>
      <span className="font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <button className="p-1 rounded hover:text-foreground transition-colors" title="下一分支">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

const AssistantMessageView: React.FC<{ agentName: string; cwd?: string | null }> = ({ agentName, cwd }) => {
  const messageId = useAuiState((s) => s.message.id);
  const running = useAuiState((s) => s.message.status?.type === "running");
  const isCopied = useAuiState((s) => s.message.isCopied);
  const acp = useStudioStore((s) => s.messages.find((m) => m.id === messageId));
  const isSystem = acp?.role === "system";
  const [turnChangesOpen, setTurnChangesOpen] = React.useState(false);

  const { progress, conclusion } = React.useMemo(
    () => partitionTurnContent(acp?.content || "", acp?.progressContent, (acp?.toolCalls?.length ?? 0) > 0),
    [acp?.content, acp?.progressContent, acp?.toolCalls]
  );

  // 本轮实际改动过的文件（edit/diff/delete 且能定位路径），去重保序。
  const editedFiles = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tc of acp?.toolCalls || []) {
      const kind = (tc.kind || "").toLowerCase();
      if (kind !== "edit" && kind !== "diff" && kind !== "delete") continue;
      const p = toolPath(tc);
      if (p && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  }, [acp?.toolCalls]);

  // 提取属于 Generative UI 的富组件工具（卡片、矢量图表、沙箱、表单）
  const generativeTools = React.useMemo(() => {
    return (acp?.toolCalls || []).filter((tc) => isGenerativeTool(tc));
  }, [acp?.toolCalls]);

  // 常规工具（命令执行、文件编辑等）保持在折叠区
  const regularTools = React.useMemo(() => {
    return (acp?.toolCalls || []).filter((tc) => !isGenerativeTool(tc));
  }, [acp?.toolCalls]);

  const citations: CitationItem[] = React.useMemo(() => {
    if (acp?.citations && Array.isArray(acp.citations) && acp.citations.length > 0) {
      return acp.citations;
    }
    // 流式生成期间跳过反复的全文字符串正则扫描，等流式结束再一次性解析
    if (running) return [];
    const content = acp?.content || "";
    if (!content.includes("http")) return [];

    const regex = /(?<!\!)\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    const items: CitationItem[] = [];
    const seen = new Set<string>();
    let match;
    let idx = 1;
    while ((match = regex.exec(content)) !== null) {
      const title = match[1].trim();
      const url = match[2].trim();
      if (!seen.has(url)) {
        seen.add(url);
        try {
          const u = new URL(url);
          items.push({
            id: `ref-${idx++}`,
            title: title.match(/^\d+$/) ? u.hostname : title,
            domain: u.hostname,
            url,
          });
        } catch {
          items.push({
            id: `ref-${idx++}`,
            title,
            url,
          });
        }
      }
    }
    return items;
  }, [acp?.citations, acp?.content]);
  // If this is an orphan/synthetic message id without backing in store, never render a phantom hanging capsule
  if (!acp && !running) {
    return null;
  }
  // 首 token 到达前：无正文、无思考、无工具调用。
  // 不渲染整张卡（空卡会被骨架屏撑成又高又窄），只给一行紧凑状态胶囊。
  const awaitingFirstToken =
    running && Boolean(acp) && !acp?.content && !acp?.thought && !(acp?.toolCalls && acp.toolCalls.length > 0) && !(acp?.images && acp.images.length > 0);

  if (awaitingFirstToken) {
    return (
      <MessagePrimitive.Root
        id={messageId}
        data-slot="message"
        data-message-id={messageId}
        data-from="assistant"
        className="flex gap-3 justify-start items-start group animate-fade-slide-in"
      >
        <div className="shrink-0 w-7 h-7 rounded-lg bg-muted border border-border flex items-center justify-center text-foreground mt-0.5 shadow-xs">
          <Bot className="w-4 h-4 text-primary" />
        </div>
        <ThinkingStateCapsule startedAt={acp?.startedAt} />
      </MessagePrimitive.Root>
    );
  }

  if (!acp) {
    return null;
  }

  // 如果某轮助手消息非运行中且完全未产生任何正文、思考、工具调用或图片（例如刚开始就被取消），不渲染幽灵空卡
  const isEmptyTurn =
    !running &&
    !acp.content &&
    !acp.thought &&
    !(acp.toolCalls && acp.toolCalls.length > 0) &&
    !(acp.images && acp.images.length > 0);
  if (isEmptyTurn) {
    return null;
  }

  return (
    <MessagePrimitive.Root
      id={messageId}
      data-slot="message"
      data-message-id={messageId}
      data-from="assistant"
      className="flex gap-3 justify-start items-start group animate-fade-slide-in"
    >
      <div className={cn(
        "shrink-0 w-7 h-7 rounded-lg border border-border flex items-center justify-center mt-0.5 shadow-xs transition-colors",
        running ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
      )}>
        <Bot className="w-4 h-4" />
      </div>
      <div
        data-streaming={running ? "true" : "false"}
        className="acp-stream-ring relative flex-1 min-w-0 max-w-full rounded-lg"
      >
      <div className="relative overflow-hidden rounded-lg p-4 sm:p-5 space-y-3 shadow-xs bg-card border border-border text-foreground">
        <div className="flex items-center justify-between gap-4 text-[11px] pb-2 border-b border-border/70">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">
              {isSystem ? "System" : agentName}
            </span>
            {acp?.model && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-mono">
                {acp.model}
              </Badge>
            )}
            {acp?.mode && acp.mode !== "default" && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono text-muted-foreground">
                {acp.mode}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            {running ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                <span className="inline-flex items-center text-muted-foreground text-[11px]">生成中…</span>
              </span>
            ) : (
              <>
                {acp?.startedAt != null && acp?.completedAt != null && (
                  <span className="font-mono tabular-nums">用时 {fmtElapsed(acp.completedAt - acp.startedAt)}</span>
                )}
                {acp?.timestamp && <span>{acp.timestamp}</span>}
              </>
            )}
          </div>
        </div>

        {acp?.plan && acp.plan.length > 0 && (
          <div className="rounded-lg bg-background/70 border border-border px-3 py-2 text-xs space-y-1.5">
            <div className="font-semibold text-muted-foreground">执行计划</div>
            {acp.plan.map((pl, idx) => (
              <div key={idx} className="flex items-center gap-2 text-muted-foreground">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    pl.status === "completed"
                      ? "bg-success"
                      : pl.status === "in_progress"
                        ? "bg-warning animate-pulse"
                        : "bg-muted-foreground",
                  )}
                />
                <span className="flex-1 truncate">{pl.content}</span>
                {pl.priority && (
                  <span className="font-mono text-[10px] text-muted-foreground">{pl.priority}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {acp?.usage && <UsagePanel msg={acp} />}

        {/* 等待态已提前 return 胶囊；此处只有到达过 token 的消息 */}
        <>
          {/* 过程区：思考链 + 阶段推进记录 + 工具组收拢，正文保持干净 */}
          {(!!acp?.thought || !!progress || regularTools.length > 0) && (
            <div className="space-y-1.5">
              {!!acp?.thought && (
                <AcpReasoningView thought={acp.thought} running={running} timing={acp.thoughtTiming} />
              )}
              {!!progress && (
                <AgentProgressAccordion progress={progress} running={running} />
              )}
              {regularTools.length > 0 && (
                <AcpToolGroup tools={regularTools} running={running} />
              )}
            </div>
          )}
          {editedFiles.length > 0 && !running && (
            <TurnDiffViewer
              files={editedFiles}
              cwd={cwd}
              className="my-2"
              onOpenChangesModal={() => setTurnChangesOpen(true)}
            />
          )}
          {/* 生成式富交互卡片 / 出版级矢量图表：优先直接高亮渲染 */}
          {generativeTools.length > 0 && (
            <div className="my-2.5 space-y-3">
              {generativeTools.map((tc) => (
                <AcpGenerativeToolCard key={tc.id} tool={tc} />
              ))}
            </div>
          )}
          <AssistantMessageBody />
          {citations.length > 0 && <Citations citations={citations} idPrefix={`msg-${messageId}`} />}
        </>

        {/* 固定 h-7 槽位：bar 的挂载/卸载只换透明度，不挤布局；
            hover 时官方 Floating 模式以 data-floating 浮层盖在卡内 */}
        <div className="flex items-center gap-1 h-7 text-muted-foreground select-none">
          <BranchPickerView />
          {editedFiles.length > 0 && !running && (
            <button
              type="button"
              onClick={() => setTurnChangesOpen(true)}
              className="flex items-center gap-1 px-1.5 py-1 rounded-lg hover:text-foreground hover:bg-muted/80 transition-colors text-[11px]"
              title={`本轮改动了 ${editedFiles.length} 个文件，点击查看/还原`}
            >
              <History className="w-3.5 h-3.5" />
              <span className="tabular-nums">改动 {editedFiles.length}</span>
            </button>
          )}
          <ActionBarPrimitive.Root
            hideWhenRunning
            autohide="not-last"
            autohideFloat="always"
            className="flex items-center gap-1 data-[floating=true]:absolute data-[floating=true]:bottom-2 data-[floating=true]:left-3 data-[floating=true]:z-10 data-[floating=true]:rounded-full data-[floating=true]:border data-[floating=true]:border-border data-[floating=true]:bg-card/95 data-[floating=true]:px-1.5 data-[floating=true]:py-1 data-[floating=true]:shadow-md data-[floating=true]:backdrop-blur"
          >
            <ActionBarPrimitive.Copy asChild>
              <MagneticButton
                strength={0.2}
                onClick={() => {
                  const toCopy = conclusion || acp?.content || "";
                  if (toCopy) {
                    navigator.clipboard.writeText(toCopy).catch(() => {});
                  }
                }}
                className="p-1.5 rounded-lg hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                title="复制最终结论"
              >
                <ActionSwap stateKey={isCopied ? "copied" : "idle"}>
                  {isCopied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                </ActionSwap>
              </MagneticButton>
            </ActionBarPrimitive.Copy>
            <ActionBarPrimitive.Reload asChild>
              <MagneticButton
                strength={0.2}
                className="p-1.5 rounded-lg hover:text-foreground hover:bg-muted/80 transition-colors"
                title="重新生成"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </MagneticButton>
            </ActionBarPrimitive.Reload>
          </ActionBarPrimitive.Root>
        </div>
      </div>
      </div>
      <TurnChanges
        open={turnChangesOpen}
        onClose={() => setTurnChangesOpen(false)}
        cwd={cwd ?? null}
        files={editedFiles}
      />
    </MessagePrimitive.Root>
  );
};

const SystemMessageView: React.FC = () => {
  const messageId = useAuiState((s) => s.message.id);
  const messages = useStudioStore((s) => s.messages);
  const idx = messages.findIndex((m) => m.id === messageId);
  const [open, setOpen] = React.useState(false);

  // 若未找到，或非连续系统消息首条，直接返回 null（由首条聚合渲染整个集群）
  if (idx < 0) return null;
  if (idx > 0 && messages[idx - 1]?.role === "system") {
    return null;
  }

  // 收集自当前节点开始的所有连续系统消息
  const cluster: Message[] = [];
  for (let i = idx; i < messages.length; i++) {
    if (messages[i].role === "system") {
      cluster.push(messages[i]);
    } else {
      break;
    }
  }

  if (cluster.length === 0) return null;

  // 单条系统消息：保持经典胶囊
  if (cluster.length === 1) {
    const content = cluster[0].content || "";
    return (
      <MessagePrimitive.Root
        id={messageId}
        data-slot="message"
        data-message-id={messageId}
        data-from="system"
        className="w-full flex items-center justify-center my-3 px-4 select-none animate-fade-slide-in"
      >
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-muted/60 border border-border/70 text-muted-foreground text-xs shadow-xs max-w-xl text-center">
          <Info className="w-3.5 h-3.5 text-muted-foreground/80 shrink-0" />
          <span className="leading-relaxed">{content}</span>
        </div>
      </MessagePrimitive.Root>
    );
  }

  // 多条连续系统消息：合并为单行紧凑动态容器，显示最新状态并支持展开，杜绝堆积霸屏
  const latest = cluster[cluster.length - 1];
  const latestSummary = latest.content.replace(/^.*?\]\s*/, "") || latest.content;

  return (
    <MessagePrimitive.Root
      id={messageId}
      data-slot="message"
      data-message-id={messageId}
      data-from="system"
      className="w-full flex flex-col items-center justify-center my-2.5 px-4 select-none animate-fade-slide-in"
    >
      <div className="rounded-2xl bg-muted/60 border border-border/70 text-muted-foreground text-xs shadow-xs max-w-xl w-fit overflow-hidden transition-all">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3.5 py-1.5 hover:bg-muted/80 transition-colors cursor-pointer select-none"
        >
          <Info className="w-3.5 h-3.5 text-muted-foreground/80 shrink-0" />
          <span className="font-semibold text-foreground text-[12px]">
            系统记录 · {cluster.length} 项操作
          </span>
          <span className="text-[11px] text-muted-foreground truncate max-w-[280px]">
            (最新: {latestSummary})
          </span>
          <ChevronDown
            className={cn("w-3.5 h-3.5 ml-1 transition-transform duration-200 shrink-0", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="border-t border-border/60 bg-muted/30 px-3.5 py-2 max-h-[140px] overflow-y-auto space-y-1 text-[11px] font-mono divide-y divide-border/40">
            {cluster.map((m, i) => (
              <div key={m.id || i} className="py-1 text-muted-foreground flex items-center justify-between gap-3">
                <span className="truncate">{m.content}</span>
                {m.timestamp && <span className="text-[10px] opacity-70 shrink-0 font-sans">{m.timestamp}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </MessagePrimitive.Root>
  );
};

const ThreadMessageRouter: React.FC<{ agentName: string; cwd?: string | null }> = ({ agentName, cwd }) => {
  const role = useAuiState((s) => s.message.role);
  if (role === "user") return <UserMessageView />;
  if (role === "system") return <SystemMessageView />;
  return <AssistantMessageView agentName={agentName} cwd={cwd} />;
};

const ThreadLoadEarlier: React.FC = () => {
  const visible = useAuiState((s) => s.thread.hasEarlier || s.thread.isLoadingEarlier);
  const loading = useAuiState((s) => s.thread.isLoadingEarlier);
  if (!visible) return null;
  return (
    <div className="flex justify-center pb-4">
      <ThreadPrimitive.LoadEarlier asChild>
        <button
          className="px-3 py-1.5 rounded-full border border-border bg-card/90 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 shadow-sm transition-colors disabled:opacity-60"
          title="加载更早的历史消息"
        >
          <span className={cn(loading && "animate-pulse")}>
            {loading ? "正在加载…" : "加载更早的消息"}
          </span>
        </button>
      </ThreadPrimitive.LoadEarlier>
    </div>
  );
};

// ---------- root view (composer 由 App 包在同一 Provider 内渲染) ----------

export const AssistantChatView: React.FC<AssistantChatViewProps> = ({
  agentName = "Agent",
  onSelectSuggestion,
  connected,
  sessionId,
  sessionError,
  sessionLoading,
  onEnsureSession,
  cwd,
}) => {
  const { viewportRef, contentRef } = useStickToBottom<HTMLDivElement>();
  return (
    <ThreadPrimitive.Root className="flex-1 flex flex-col min-h-0 bg-background relative overflow-hidden">
      <MessageScroller
        navigation="rail"
        externalViewportRef={viewportRef}
        showScrollToBottom={false}
        railClassName="right-2.5 z-20"
      >
        <ThreadPrimitive.Viewport
          ref={viewportRef}
          turnAnchor="top"
          autoScroll={false}
          className="flex-1 overflow-y-auto [scrollbar-gutter:stable] p-4 md:p-6"
        >
          <ThreadPrimitive.Empty>
            <AssistantWelcome
              agentName={agentName}
              onSelectSuggestion={onSelectSuggestion}
              connected={connected}
              sessionId={sessionId}
              sessionError={sessionError}
              sessionLoading={sessionLoading}
              onEnsureSession={onEnsureSession}
              cwd={cwd}
            />
          </ThreadPrimitive.Empty>
          <div ref={contentRef} className="max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto space-y-6 px-3 sm:px-4">
            <ThreadLoadEarlier />
            <ThreadPrimitive.Messages>
              {() => <ThreadMessageRouter agentName={agentName} cwd={cwd} />}
            </ThreadPrimitive.Messages>
          </div>
          <ThreadPrimitive.ViewportFooter className="max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto sticky bottom-0 z-10 flex justify-center pointer-events-none h-0 overflow-visible">
            <ThreadPrimitive.ScrollToBottom asChild>
              <button
                className="absolute bottom-3 pointer-events-auto flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-popover text-xs text-muted-foreground hover:text-foreground shadow-md transition-colors disabled:invisible"
                title="回到底部"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                回到底部
              </button>
            </ThreadPrimitive.ScrollToBottom>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </MessageScroller>
    </ThreadPrimitive.Root>
  );
};

export const AssistantLoadingSkeleton: React.FC = () => (
  <div className="space-y-2 py-1 max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto px-3 sm:px-4">
    <Skeleton className="h-3.5 w-[92%]" />
    <Skeleton className="h-3.5 w-[78%]" />
    <Skeleton className="h-3.5 w-[64%]" />
  </div>
);
