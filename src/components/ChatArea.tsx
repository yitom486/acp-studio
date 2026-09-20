import React, { useEffect, useRef } from "react";
import { User, Sparkles, Terminal, Copy, Check, Wrench, ShieldAlert, FileText, ArrowRight } from "lucide-react";
import { Badge } from "./ui/badge";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  mode?: string;
  timestamp: string;
  toolCalls?: Array<{
    id: string;
    title: string;
    status: "running" | "completed" | "failed";
  }>;
  isStreaming?: boolean;
}

export interface ChatAreaProps {
  messages: Message[];
  isStreaming: boolean;
  selectedModel: string;
  selectedMode: string;
  onSelectSuggestion: (prompt: string) => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  isStreaming,
  selectedModel,
  selectedMode,
  onSelectSuggestion,
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
      title: "查看实时 Token 配额",
      prompt: "/usage",
      desc: "直接调用 ACP 快捷命令检查您的 Google 账户限额与余量",
    },
    {
      title: "解释当前目录工程结构",
      prompt: "请简要分析当前项目目录下有哪些关键文件和模块，架构是如何组织的？",
      desc: "使用 Antigravity Agent 读取并解析本地文件系统",
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
            <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-indigo-500/20 via-purple-500/20 to-pink-500/20 border border-indigo-500/30 text-indigo-400 mb-2 shadow-inner">
              <Sparkles className="w-8 h-8" />
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Google Antigravity <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">Studio</span>
            </h2>
            <p className="text-sm text-slate-400 max-w-lg mx-auto leading-relaxed">
              基于原生 <strong>Google Antigravity CLI (agy.exe)</strong> 引擎。零临时磁盘解压占用，毫秒级响应，支持多轮会话上下文流式输出与自主工具调用。
            </p>
          </div>

          {/* Quick Suggestions Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            {suggestions.map((item, idx) => (
              <div
                key={idx}
                onClick={() => onSelectSuggestion(item.prompt)}
                className="group p-4 rounded-xl border border-slate-800/80 bg-slate-900/60 hover:bg-slate-800/80 hover:border-indigo-500/40 transition-all duration-200 cursor-pointer text-left space-y-1.5 shadow-sm hover:shadow-indigo-500/10"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200 group-hover:text-indigo-300 transition-colors">
                    {item.title}
                  </h4>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Messages Thread */
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3.5 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {/* Agent Avatar */}
              {msg.role === "assistant" && (
                <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 mt-1">
                  <Sparkles className="w-4 h-4" />
                </div>
              )}

              {/* Message Content Container */}
              <div
                className={`max-w-[85%] rounded-2xl p-4.5 space-y-2.5 shadow-lg ${
                  msg.role === "user"
                    ? "bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-sm"
                    : "bg-slate-900/90 border border-slate-800 text-slate-100 rounded-tl-sm backdrop-blur-md"
                }`}
              >
                {/* Meta info header */}
                <div className="flex items-center justify-between gap-4 text-[11px] pb-1 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-200">
                      {msg.role === "user" ? "You" : "Antigravity Agent"}
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
                  <div className="flex items-center gap-2 text-slate-400">
                    <span>{msg.timestamp}</span>
                    {msg.role === "assistant" && (
                      <button
                        onClick={() => handleCopy(msg.id, msg.content)}
                        className="hover:text-white transition-colors"
                        title="复制内容"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Tool Calls (if emitted by ACP) */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {msg.toolCalls.map((tc, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-300 font-mono"
                      >
                        <Wrench className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="flex-1 truncate">{tc.title}</span>
                        <span
                          className={`w-2 h-2 rounded-full ${
                            tc.status === "running"
                              ? "bg-amber-400 animate-pulse"
                              : tc.status === "completed"
                              ? "bg-emerald-400"
                              : "bg-rose-400"
                          }`}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Message Body text */}
                <div className="text-sm leading-relaxed whitespace-pre-wrap font-sans break-words selection:bg-indigo-500/40">
                  {msg.content}
                  {msg.isStreaming && (
                    <span className="inline-block w-2 h-4 ml-1 bg-indigo-400 animate-pulse align-middle" />
                  )}
                </div>
              </div>

              {/* User Avatar */}
              {msg.role === "user" && (
                <div className="shrink-0 w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shadow-md mt-1">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
};
