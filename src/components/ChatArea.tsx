import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { User, Sparkles, Terminal, Copy, Check, Wrench, ShieldAlert, FileText, ArrowRight, FileDiff } from "lucide-react";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { BlurFade } from "./magicui/blur-fade";
import { AnimatedShinyText } from "./magicui/animated-shiny-text";
import { Markdown } from "./universal/Markdown";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thought?: string;
  plan?: Array<{ content: string; priority?: string; status?: string }>;
  usage?: { used: number; size: number; cost?: { amount: number; currency: string } };
  model?: string;
  mode?: string;
  timestamp: string;
  toolCalls?: Array<{
    id: string;
    title: string;
    kind?: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
  }>;
  isStreaming?: boolean;
}

export interface ChatAreaProps {
  messages: Message[];
  isStreaming: boolean;
  selectedModel: string;
  selectedMode: string;
  onSelectSuggestion: (prompt: string) => void;
  agentName?: string;
  onOpenDiff?: (filePath?: string | null) => void;
}

function extractFileFromTool(title: string): string | null {
  if (!title) return null;
  const match = title.match(/([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]{1,10})/);
  if (match) {
    const candidate = match[1];
    if (
      candidate.includes("/") ||
      candidate.includes("\\") ||
      /\.(tsx?|jsx?|json|md|css|html|rs|py|go|cs)$/i.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  isStreaming,
  selectedModel,
  selectedMode,
  onSelectSuggestion,
  agentName = "Agent",
  onOpenDiff,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const suggestions = [
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

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
      {messages.length === 0 ? (
        /* Empty / Welcome Hero */
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

          {/* Quick Suggestions Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            {suggestions.map((item, idx) => (
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
      ) : (
        /* Messages Thread */
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((msg, index) => {
            if (msg.role === "user") {
              return (
                <BlurFade
                  key={msg.id}
                  delay={0.03 * Math.min(index, 4)}
                  className="flex gap-3 justify-end items-start group"
                >
                  <div className="flex flex-col items-end gap-1 max-w-[80%]">
                    {/* User message bubble: comfortable padding, rounded tail, break words, no overflow */}
                    <div className="rounded-2xl rounded-tr-xs bg-primary text-primary-foreground px-4 py-2.5 shadow-sm break-words whitespace-pre-wrap text-sm leading-relaxed font-sans selection:bg-background/25">
                      {msg.content}
                    </div>
                    {/* Timestamp & subtle copy on hover */}
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 px-1 font-mono">
                      <span>{msg.timestamp}</span>
                      <button
                        onClick={() => handleCopy(msg.id, msg.content)}
                        className="opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
                        title="复制内容"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3 h-3 text-success" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                  {/* User Avatar */}
                  <div className="shrink-0 w-8 h-8 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center text-primary shadow-sm mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                </BlurFade>
              );
            }

            const awaitingFirstToken =
              msg.role === "assistant" &&
              !!msg.isStreaming &&
              !msg.content &&
              !msg.thought &&
              !(msg.toolCalls && msg.toolCalls.length > 0);

            return (
              <BlurFade
                key={msg.id}
                delay={0.03 * Math.min(index, 4)}
                className="flex gap-3.5 justify-start items-start group"
              >
                {/* Agent Avatar */}
                <div className="shrink-0 w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-primary-foreground mt-1 shadow-sm">
                  <Sparkles className="w-4 h-4" />
                </div>

                {/* Message Content Container */}
                <div className="max-w-[85%] rounded-2xl rounded-tl-xs p-4 sm:p-5 space-y-3 shadow-md bg-card/90 border border-border text-foreground backdrop-blur-md">
                  {/* Meta info header */}
                  <div className="flex items-center justify-between gap-4 text-[11px] pb-2 border-b border-border/70">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {msg.role === "system" ? "System" : agentName}
                      </span>
                      {msg.model && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-mono">
                          {msg.model}
                        </Badge>
                      )}
                      {msg.mode && msg.mode !== "default" && (
                        <Badge variant="warning" className="text-[10px] h-4 px-1.5 font-mono">
                          {msg.mode}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{msg.timestamp}</span>
                      <button
                        onClick={() => handleCopy(msg.id, msg.content)}
                        className="hover:text-foreground transition-colors"
                        title="复制内容"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3.5 h-3.5 text-success" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Tool Calls (if emitted by ACP) */}
                  {msg.isStreaming && !msg.thought && (
                    <div className="text-xs">
                      <AnimatedShinyText>正在思考…</AnimatedShinyText>
                    </div>
                  )}
                  {msg.thought && (
                    <details className="rounded-lg bg-background/70 border border-primary/20 px-3 py-2 text-xs text-primary/90" open={!!msg.isStreaming}>
                      <summary className="cursor-pointer font-medium text-primary">思考过程 ({msg.thought.length} 字)</summary>
                      <div className="pt-1.5 whitespace-pre-wrap font-sans break-words opacity-90">{msg.thought}</div>
                    </details>
                  )}

                  {msg.plan && msg.plan.length > 0 && (
                    <div className="rounded-lg bg-background/70 border border-border px-3 py-2 text-xs space-y-1.5">
                      <div className="font-semibold text-muted-foreground">执行计划</div>
                      {msg.plan.map((pl, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-muted-foreground">
                          <span className={`w-1.5 h-1.5 rounded-full ${pl.status === "completed" ? "bg-success" : pl.status === "in_progress" ? "bg-warning animate-pulse" : "bg-muted-foreground"}`} />
                          <span className="flex-1 truncate">{pl.content}</span>
                          {pl.priority && <span className="font-mono text-[10px] text-muted-foreground">{pl.priority}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {msg.toolCalls.map((tc, idx) => {
                        const targetFile = extractFileFromTool(tc.title);
                        const isFileTool = tc.kind === "edit" || tc.kind === "file" || tc.kind === "diff" || !!targetFile;

                        return (
                          <div
                            key={idx}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-background/80 border border-border text-xs text-muted-foreground font-mono"
                          >
                            <Wrench className="w-3.5 h-3.5 text-primary shrink-0" />
                            {tc.status === "running" || tc.status === "pending" ? (
                              <span className="flex-1 truncate" title={tc.kind ? `${tc.title} [${tc.kind}]` : tc.title}>
                                <AnimatedShinyText>{tc.title}</AnimatedShinyText>
                              </span>
                            ) : (
                              <span className="flex-1 truncate" title={tc.kind ? `${tc.title} [${tc.kind}]` : tc.title}>
                                {tc.title}
                              </span>
                            )}

                            {onOpenDiff && isFileTool && (
                              <button
                                type="button"
                                onClick={() => onOpenDiff(targetFile)}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-sans transition-colors shrink-0"
                                title={targetFile ? `在 Git 审查中查看 ${targetFile}` : "在 Git 审查中查看变更"}
                              >
                                <FileDiff className="w-3 h-3" />
                                <span>Diff</span>
                              </button>
                            )}

                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                tc.status === "running" || tc.status === "pending"
                                  ? "bg-warning animate-pulse"
                                  : tc.status === "completed"
                                  ? "bg-success"
                                  : tc.status === "cancelled"
                                  ? "bg-muted-foreground"
                                  : "bg-destructive"
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {msg.usage && (
                    <div className="font-mono text-[10px] text-muted-foreground">
                      context {msg.usage.used.toLocaleString()}/{msg.usage.size.toLocaleString()}
                      {msg.usage.cost ? ` · $${msg.usage.cost.amount} ${msg.usage.cost.currency}` : ""}
                    </div>
                  )}

                  {/* Message Body text / waiting skeleton */}
                  {awaitingFirstToken ? (
                    <div className="space-y-2 py-1">
                      <Skeleton className="h-3.5 w-[92%]" />
                      <Skeleton className="h-3.5 w-[78%]" />
                      <Skeleton className="h-3.5 w-[64%]" />
                      <AnimatedShinyText className="text-xs">正在等待 {agentName} 响应…</AnimatedShinyText>
                    </div>
                  ) : (
                    <div>
                      <Markdown text={msg.content} />
                      {msg.isStreaming && (
                        <motion.span
                          className="inline-block w-2 h-4 ml-1 bg-primary align-middle"
                          animate={{ opacity: [1, 0.15, 1] }}
                          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </BlurFade>
            );
          })}

          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
};
