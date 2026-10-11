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
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedShinyText } from "@/components/magicui/animated-shiny-text";
import { AcpMarkdownText } from "@/components/assistant/AcpMarkdown";
import { AcpImagePart } from "@/components/assistant/AcpMedia";
import {
  DiffButton,
  FileEditCard,
  FileReadCard,
  InlineApproval,
  LiveElapsed,
  SearchCard,
  StatusDot,
  TerminalCard,
} from "@/components/assistant/AcpToolWidgets";
import {
  extractFileFromTool,
  fmtElapsed,
  resolveToolDisplayTitle,
  resolveWidgetKey,
  toolPath,
  type WidgetTool,
} from "@/components/assistant/tool-widget-utils";
import type { Message } from "@/components/ChatArea";
import type { UsageState } from "@/stores/useStudioStore";
import { useStudioStore } from "@/stores/useStudioStore";
import { cn } from "@/lib/utils";

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
}

// ---------- part renderers (Text 由 AcpMarkdownText 直供 primitive) ----------

/** 流式等待中的三点弹跳（纯 CSS，无需数据）。 */
const BouncingDots: React.FC = () => (
  <span className="inline-flex items-center gap-1" aria-hidden>
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
        style={{ animationDelay: `${i * 150}ms` }}
      />
    ))}
  </span>
);

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
            className={cn("h-full rounded-full transition-all duration-500", bar)}
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
 * 思维链 · 思考过程折叠卡（社区 ChainOfThought 的轻量实现）。
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
    <div className="rounded-lg bg-background/70 border border-primary/20 text-xs text-primary/90 overflow-hidden">
      <button
        type="button"
        onClick={() => {
          manual.current = true;
          setOpen((o) => !o);
        }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-primary/5 transition-colors"
      >
        <Brain className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="font-medium text-primary">思考过程</span>
        <span className="font-mono text-[10px] opacity-70">({thought.length} 字)</span>
        {running ? (
          <AnimatedShinyText className="text-[11px]">思考中…</AnimatedShinyText>
        ) : (
          doneMs != null && (
            <span className="font-mono text-[10px] opacity-70">用时 {fmtElapsed(doneMs)}</span>
          )
        )}
        <ChevronDown
          className={cn("w-3.5 h-3.5 ml-auto text-primary transition-transform duration-300", open && "rotate-180")}
        />
      </button>
      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-2.5 pt-0.5 whitespace-pre-wrap font-sans break-words opacity-90">
            {thought}
          </div>
        </div>
      </div>
    </div>
  );
};

type AcpToolCall = WidgetTool;

/** 单条工具行（未知种类回落；含 Diff 快捷入口 + 内联审批）。 */
const ToolCallRow: React.FC<{ tc: AcpToolCall }> = ({ tc }) => {
  const { kind = "", status } = tc;
  const displayTitle = resolveToolDisplayTitle(tc);
  const targetFile = extractFileFromTool(displayTitle) || toolPath(tc);
  const isFileTool =
    kind === "edit" || kind === "file" || kind === "diff" || !!targetFile;
  const active = status === "running" || status === "pending";
  const shortId = tc.id ? (tc.id.length > 12 ? `${tc.id.slice(0, 8)}…` : tc.id) : null;

  return (
    <div className="rounded-lg bg-background/80 border border-border text-xs text-muted-foreground animate-fade-slide-in">
      <div className="flex items-center gap-2 px-2.5 py-1.5 font-mono">
        <Wrench className="w-3.5 h-3.5 text-primary shrink-0" />
        <span
          className={cn("flex-1 truncate", active && "animate-pulse")}
          title={kind ? `${displayTitle} [${kind}] (ID: ${tc.id})` : `${displayTitle} (ID: ${tc.id})`}
        >
          {displayTitle}
        </span>
        {shortId && (
          <span
            className="text-[10px] text-muted-foreground/50 hover:text-foreground font-mono shrink-0 select-all cursor-default"
            title={`调用 ID: ${tc.id}`}
          >
            {shortId}
          </span>
        )}
        <LiveElapsed startedAt={tc.startedAt} completedAt={tc.completedAt} />
        {isFileTool && <DiffButton file={targetFile} />}
        <StatusDot status={status} />
      </div>
      <InlineApproval tc={tc} />
    </div>
  );
};

/** 按工具种类分发富卡片，未知种类回落通用行。 */
const ToolWidget: React.FC<{ tc: AcpToolCall }> = ({ tc }) => {
  switch (resolveWidgetKey(tc)) {
    case "terminal":
      return <TerminalCard tc={tc} />;
    case "file-read":
      return <FileReadCard tc={tc} />;
    case "file-edit":
      return <FileEditCard tc={tc} />;
    case "search":
      return <SearchCard tc={tc} />;
    default:
      return <ToolCallRow tc={tc} />;
  }
};

/**
 * 工具折叠组（社区 ToolGroup 模式）：连续工具调用收成一行摘要，
 * 运行时默认展开、完成后自动收起，不再逐条侵入正文。
 * 用户手动切换后尊重用户意图；若再次有新工具运行则重新自动展开。
 */
const AcpToolGroup: React.FC<{ tools: AcpToolCall[]; running?: boolean }> = ({ tools, running = false }) => {
  const activeTools = tools.filter((t) => t.status === "running" || t.status === "pending");
  const failed = tools.some((t) => t.status === "failed");
  const anyActive = activeTools.length > 0;
  const [open, setOpen] = React.useState(anyActive);
  const manual = React.useRef(false);
  const prevActive = React.useRef(anyActive);

  React.useEffect(() => {
    // 当状态从无活动变为有活动（新工具启动）时，重置用户手动标记并自动展开
    if (anyActive && !prevActive.current) {
      manual.current = false;
      setOpen(true);
    }
    // 当所有工具完成（从有活动变为无活动），或当前 AI 回答整体结束（running 变 false）时，自动收起
    else if (!anyActive && prevActive.current) {
      if (!manual.current) {
        setOpen(false);
      }
    } else if (!running && !anyActive) {
      if (!manual.current) {
        setOpen(false);
      }
    }
    prevActive.current = anyActive;
  }, [anyActive, running]);

  const latest = activeTools.length > 0 ? activeTools[activeTools.length - 1] : null;
  if (!tools || tools.length === 0) return null;
  return (
    <div className="rounded-lg bg-background/70 border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => {
          manual.current = true;
          setOpen((o) => !o);
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
      >
        <Wrench className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="font-medium">工具调用 · {tools.length}</span>
        {latest ? (
          <AnimatedShinyText className="text-[11px] truncate">正在调用 {resolveToolDisplayTitle(latest)}…</AnimatedShinyText>
        ) : (
          <span className="font-mono text-[10px] opacity-70">
            {failed ? "有失败" : "全部完成"}
          </span>
        )}
        <span
          className={cn(
            "w-2 h-2 rounded-full shrink-0",
            activeTools.length > 0
              ? "bg-warning animate-pulse"
              : failed
                ? "bg-destructive"
                : "bg-success",
          )}
        />
        <ChevronDown
          className={cn("w-3.5 h-3.5 ml-auto transition-transform duration-300", open && "rotate-180")}
        />
      </button>
      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-1.5 pb-1.5 space-y-1.5">
            {tools.map((tc) => (
              <ToolWidget key={tc.id} tc={tc} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- messages ----------

const SUGGESTIONS = [
  {
    title: "查看可用命令",
    prompt: "/status",
    desc: "调用 Agent 广播的 slash 命令查看状态与配额",
  },
  {
    title: "解释当前目录工程结构",
    prompt: "请简要分析当前项目目录下有哪些关键文件和模块，架构是如何组织的？",
    desc: "使用 Agent 读取并解析本地文件系统",
  },
  {
    title: "写一个 ACP 客户端测试用例",
    prompt: "请使用 TypeScript 写一个轻量级的 ACP stdio client 示例代码",
    desc: "展示 ACP JSON-RPC 2.0 握手与消息订阅实现",
  },
  {
    title: "设计一个分布式缓存方案 (Plan 模式)",
    prompt: "请为一个高并发多节点应用设计一个基于 Redis 和内存二级缓存的完整实施方案",
    desc: "启动规划与推理分析",
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
}> = ({ agentName, onSelectSuggestion, connected, sessionId, sessionError, sessionLoading, onEnsureSession }) => (
  <div className="max-w-3xl mx-auto py-8 md:py-12 space-y-8 animate-in fade-in duration-300">
    <div className="text-center space-y-3">
      <div className="inline-flex p-3 rounded-2xl bg-primary/10 border border-primary/25 text-primary mb-2">
        <Sparkles className="w-8 h-8" />
      </div>
      <h2 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
        {agentName} <span className="text-primary">Studio</span>
      </h2>
      <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
        基于 <strong>Agent Client Protocol (ACP)</strong> 的通用智能体工作台。支持多轮会话流式输出、思考过程折叠、工具调用审计、图片与文件附件直注。
      </p>
    </div>
    {connected && !sessionId && (
      <div
        className={cn(
          "mx-auto max-w-lg rounded-xl border px-4 py-3 text-xs space-y-2",
          sessionError ? "border-warning/40 bg-warning/10" : "border-primary/25 bg-primary/5",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "w-2 h-2 rounded-full shrink-0",
              sessionLoading ? "bg-primary animate-pulse" : sessionError ? "bg-warning" : "bg-muted-foreground",
            )}
          />
          {sessionLoading ? (
            <AnimatedShinyText className="text-xs">正在建立会话，模型列表马上就来…</AnimatedShinyText>
          ) : sessionError ? (
            <span className="text-warning">建会话失败：{sessionError}</span>
          ) : (
            <span className="text-muted-foreground">已连接，尚未建立会话</span>
          )}
          {!sessionLoading && (
            <button
              type="button"
              onClick={() => onEnsureSession?.()}
              className="ml-auto px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity shrink-0"
            >
              {sessionError ? "重试" : "建立会话"}
            </button>
          )}
        </div>
      </div>
    )}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
      {SUGGESTIONS.map((item, idx) => (
        <div
          key={idx}
          onClick={() => onSelectSuggestion(item.prompt)}
          className="group p-4 rounded-xl border border-border/80 bg-card/60 hover:bg-muted/80 hover:border-primary/40 transition-all duration-200 cursor-pointer text-left space-y-1.5 shadow-sm hover:shadow-primary/10"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
              {item.title}
            </h4>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">{item.desc}</p>
        </div>
      ))}
    </div>
  </div>
);

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
    <MessagePrimitive.Root className="flex gap-3 justify-end items-start group animate-fade-slide-in">
      <div className="relative max-w-[80%]">
        <div className="rounded-2xl rounded-tr-xs bg-primary text-primary-foreground px-4 py-2.5 shadow-sm break-words whitespace-pre-wrap text-sm leading-relaxed font-sans">
          <MessagePrimitive.Parts components={{ Text: AcpMarkdownText }} />
          {/* 底部 meta 单行：常驻挂载，只换透明度，宽高恒定不挤布局 */}
          <div className="flex items-center justify-end gap-0.5 pt-1.5">
            {acp?.timestamp && (
              <span className="text-[10px] font-mono opacity-60 select-none mr-1">{acp.timestamp}</span>
            )}
            <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100 transition-opacity">
              <button
                onClick={copy}
                className="p-1 rounded-md text-primary-foreground hover:bg-primary-foreground/10 transition-colors"
                title="复制内容"
              >
                {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
              </button>
              <ActionBarPrimitive.Root className="flex items-center">
                <ActionBarPrimitive.Edit asChild>
                  <button
                    disabled={threadRunning}
                    className="p-1 rounded-md text-primary-foreground hover:bg-primary-foreground/10 transition-colors disabled:opacity-40"
                    title="编辑后重发"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </ActionBarPrimitive.Edit>
              </ActionBarPrimitive.Root>
            </span>
          </div>
        </div>
        <div className="flex justify-end">
          <BranchPickerView className="justify-end" />
        </div>
      </div>
      <div className="shrink-0 w-8 h-8 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center text-primary shadow-sm mt-0.5">
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

const AssistantMessageView: React.FC<{ agentName: string }> = ({ agentName }) => {
  const messageId = useAuiState((s) => s.message.id);
  const running = useAuiState((s) => s.message.status?.type === "running");
  const isCopied = useAuiState((s) => s.message.isCopied);
  const acp = useStudioStore((s) => s.messages.find((m) => m.id === messageId));
  const isSystem = acp?.role === "system";
  // 首 token 到达前：无正文、无思考、无工具调用。
  // 不渲染整张卡（空卡会被骨架屏撑成又高又窄），只给一行紧凑状态胶囊。
  const awaitingFirstToken =
    running && !acp?.content && !acp?.thought && !(acp?.toolCalls && acp.toolCalls.length > 0) && !(acp?.images && acp.images.length > 0);

  if (awaitingFirstToken) {
    return (
      <MessagePrimitive.Root className="flex gap-3.5 justify-start items-start group animate-fade-slide-in">
        <div className="shrink-0 w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-primary-foreground mt-1 shadow-sm animate-pulse">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex items-center gap-2.5 rounded-2xl rounded-tl-xs border border-border/60 bg-card/60 px-4 py-3 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
          <AnimatedShinyText className="text-sm whitespace-nowrap">正在思考…</AnimatedShinyText>
          <BouncingDots />
        </div>
      </MessagePrimitive.Root>
    );
  }

  return (
    <MessagePrimitive.Root className="flex gap-3.5 justify-start items-start group animate-fade-slide-in">
      <div className={cn(
        "shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-1 shadow-sm transition-colors",
        running ? "bg-primary text-primary-foreground animate-pulse" : "bg-primary text-primary-foreground",
      )}>
        <Sparkles className="w-4 h-4" />
      </div>
      <div className="relative overflow-hidden max-w-[85%] rounded-2xl rounded-tl-xs p-4 sm:p-5 space-y-3 shadow-md bg-card/90 border border-border text-foreground backdrop-blur-md">
        {running && (
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/80 to-transparent animate-pulse" />
        )}
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
              <Badge variant="warning" className="text-[10px] h-4 px-1.5 font-mono">
                {acp.mode}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            {running ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                <AnimatedShinyText className="text-[11px]">生成中…</AnimatedShinyText>
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
          {/* 思维链：思考 + 工具组收拢，正文保持干净 */}
          {(!!acp?.thought || (acp?.toolCalls && acp.toolCalls.length > 0)) && (
            <div className="space-y-1.5">
              {!!acp?.thought && (
                <AcpReasoningView thought={acp.thought} running={running} timing={acp.thoughtTiming} />
              )}
              {acp?.toolCalls && acp.toolCalls.length > 0 && (
                <AcpToolGroup tools={acp.toolCalls} running={running} />
              )}
            </div>
          )}
          <div className="space-y-2">
            <MessagePrimitive.Parts
              components={{
                Text: AcpMarkdownText,
                Reasoning: () => null,
                Image: AcpImagePart,
                tools: { Fallback: () => null },
              }}
            />
            {running && (
              <span className="inline-block w-2 h-4 ml-1 bg-primary align-middle animate-pulse" />
            )}
          </div>
        </>

        {/* 固定 h-7 槽位：bar 的挂载/卸载只换透明度，不挤布局；
            hover 时官方 Floating 模式以 data-floating 浮层盖在卡内 */}
        <div className="flex items-center gap-1 h-7 text-muted-foreground select-none">
          <BranchPickerView />
          <ActionBarPrimitive.Root
            hideWhenRunning
            autohide="not-last"
            autohideFloat="always"
            className="flex items-center gap-1 data-[floating=true]:absolute data-[floating=true]:bottom-2 data-[floating=true]:left-3 data-[floating=true]:z-10 data-[floating=true]:rounded-full data-[floating=true]:border data-[floating=true]:border-border data-[floating=true]:bg-card/95 data-[floating=true]:px-1.5 data-[floating=true]:py-1 data-[floating=true]:shadow-md data-[floating=true]:backdrop-blur"
          >
            <ActionBarPrimitive.Copy asChild>
              <button
                className="p-1.5 rounded-lg hover:text-foreground hover:bg-muted/80 transition-colors"
                title="复制内容"
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </ActionBarPrimitive.Copy>
            <ActionBarPrimitive.Reload asChild>
              <button
                className="p-1.5 rounded-lg hover:text-foreground hover:bg-muted/80 transition-colors"
                title="重新生成"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </ActionBarPrimitive.Reload>
          </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const ThreadMessageRouter: React.FC<{ agentName: string }> = ({ agentName }) => {
  const role = useAuiState((s) => s.message.role);
  if (role === "user") return <UserMessageView />;
  return <AssistantMessageView agentName={agentName} />;
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
}) => {
  return (
    <ThreadPrimitive.Root className="flex-1 flex flex-col min-h-0 bg-background">
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="flex-1 overflow-y-auto p-4 md:p-6"
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
          />
        </ThreadPrimitive.Empty>
        <div className="max-w-4xl mx-auto space-y-6">
          <ThreadLoadEarlier />
          <ThreadPrimitive.Messages>
            {() => <ThreadMessageRouter agentName={agentName} />}
          </ThreadPrimitive.Messages>
        </div>
        <ThreadPrimitive.ViewportFooter className="max-w-4xl mx-auto sticky bottom-0 z-10 flex justify-center pointer-events-none h-0 overflow-visible">
          <ThreadPrimitive.ScrollToBottom asChild>
            <button
              className="absolute bottom-3 pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card/90 backdrop-blur text-xs text-muted-foreground hover:text-primary hover:border-primary/40 shadow-md transition-colors disabled:invisible"
              title="回到底部"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              回到底部
            </button>
          </ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

export const AssistantLoadingSkeleton: React.FC = () => (
  <div className="space-y-2 py-1 max-w-4xl mx-auto">
    <Skeleton className="h-3.5 w-[92%]" />
    <Skeleton className="h-3.5 w-[78%]" />
    <Skeleton className="h-3.5 w-[64%]" />
  </div>
);
