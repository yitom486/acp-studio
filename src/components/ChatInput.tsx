import React, { useRef, useEffect } from "react";
import { Send, Square, Trash2, Sparkles, Command } from "lucide-react";
import { Button } from "./ui/button";

export interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onClear: () => void;
  isStreaming: boolean;
  selectedModel: string;
  selectedMode: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  input,
  setInput,
  onSend,
  onStop,
  onClear,
  isStreaming,
  selectedModel,
  selectedMode,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && input.trim()) {
        onSend();
      }
    }
  };

  return (
    <div className="p-4 md:p-6 bg-slate-950/90 border-t border-slate-800/80 backdrop-blur-xl shrink-0">
      <div className="max-w-4xl mx-auto space-y-2">
        {/* Input box */}
        <div className="relative flex flex-col rounded-2xl border border-slate-700/80 bg-slate-900/90 shadow-2xl focus-within:border-indigo-500/70 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "Antigravity Agent 正在响应中..."
                : "输入给 Antigravity 的需求或指令 (例如：分析代码、/usage、编写功能)..."
            }
            disabled={isStreaming}
            className="w-full resize-none bg-transparent px-4 py-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none max-h-48 min-h-[48px]"
          />

          {/* Bottom toolbar inside input card */}
          <div className="flex items-center justify-between px-3.5 pb-2.5 pt-1 text-xs">
            <div className="flex items-center gap-2 text-slate-400">
              <span className="font-mono text-[11px] text-slate-500 hidden sm:inline">
                Enter 发送 &bull; Shift+Enter 换行
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClear}
                disabled={isStreaming}
                title="清空聊天记录"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition-colors disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              {isStreaming ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={onStop}
                  className="h-8 gap-1.5 rounded-lg text-xs"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="default"
                  onClick={onSend}
                  disabled={!input.trim()}
                  className="h-8 gap-1.5 rounded-lg text-xs font-semibold"
                >
                  <Send className="w-3.5 h-3.5" />
                  发送
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
          <div className="flex items-center gap-2">
            <span>运行内核：Google 官方 agy_acp_server</span>
            <span>&bull;</span>
            <span>协议：Agent Client Protocol (ACP)</span>
          </div>
          <div>按需支持工具自主读写与终端命令调度</div>
        </div>
      </div>
    </div>
  );
};
