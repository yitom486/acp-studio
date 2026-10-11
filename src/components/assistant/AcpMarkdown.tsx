import React, { memo, useMemo, useState } from "react";
import {
  MarkdownTextPrimitive,
  memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
  type CodeHeaderProps,
} from "@assistant-ui/react-markdown";
import "@assistant-ui/react-markdown/styles/dot.css";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import type { TextMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";

const AcpCodeHeader: React.FC<CodeHeaderProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!code || copied) return;
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="mt-2 flex items-center justify-between rounded-t-lg border border-b-0 border-border bg-background/80 px-3 py-1 text-[11px] font-mono text-muted-foreground">
      <span>{language || "code"}</span>
      <button onClick={copy} className="flex items-center gap-1 hover:text-foreground transition-colors" title="复制代码">
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
};

/** 与旧 Markdown.tsx 一致的 Tailwind 映射，经 memoize stable 化避免流式重渲染。 */
const acpComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }: any) => (
    <h1 className={cn("text-base font-bold text-foreground mt-3 mb-1.5", className)} {...props} />
  ),
  h2: ({ className, ...props }: any) => (
    <h2 className={cn("text-[15px] font-bold text-foreground mt-3 mb-1.5", className)} {...props} />
  ),
  h3: ({ className, ...props }: any) => (
    <h3 className={cn("text-sm font-bold text-foreground mt-2.5 mb-1", className)} {...props} />
  ),
  h4: ({ className, ...props }: any) => (
    <h4 className={cn("text-[13px] font-bold text-foreground mt-2 mb-1", className)} {...props} />
  ),
  p: ({ className, ...props }: any) => (
    <p className={cn("my-1.5 leading-relaxed", className)} {...props} />
  ),
  ul: ({ className, ...props }: any) => (
    <ul className={cn("my-1.5 ml-4 list-disc space-y-1 marker:text-muted-foreground", className)} {...props} />
  ),
  ol: ({ className, ...props }: any) => (
    <ol className={cn("my-1.5 ml-4 list-decimal space-y-1 marker:text-muted-foreground", className)} {...props} />
  ),
  li: ({ className, ...props }: any) => (
    <li className={cn("leading-relaxed", className)} {...props} />
  ),
  blockquote: ({ className, ...props }: any) => (
    <blockquote className={cn("my-2 border-l-2 border-primary/50 pl-3 text-muted-foreground", className)} {...props} />
  ),
  a: ({ className, ...props }: any) => (
    <a className={cn("text-primary underline-offset-2 hover:underline")} target="_blank" rel="noreferrer" {...props} />
  ),
  strong: ({ className, ...props }: any) => (
    <strong className={cn("font-semibold text-foreground", className)} {...props} />
  ),
  hr: ({ className, ...props }: any) => <hr className={cn("my-3 border-border", className)} {...props} />,
  table: ({ className, ...props }: any) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className={cn("w-full text-xs", className)} {...props} />
    </div>
  ),
  thead: ({ className, ...props }: any) => (
    <thead className={cn("bg-muted/60", className)} {...props} />
  ),
  th: ({ className, ...props }: any) => (
    <th className={cn("px-2.5 py-1.5 text-left font-semibold text-foreground border-b border-border", className)} {...props} />
  ),
  td: ({ className, ...props }: any) => (
    <td className={cn("px-2.5 py-1.5 border-b border-border/60 align-top", className)} {...props} />
  ),
  pre: ({ className, ...props }: any) => (
    <pre className={cn("overflow-x-auto rounded-b-lg border border-t-0 border-border bg-background/80 px-3 py-2.5 text-xs leading-relaxed font-mono text-foreground", className)} {...props} />
  ),
  code: function AcpCode({ className, ...props }: any) {
    const isBlock = useIsMarkdownCodeBlock();
    if (!isBlock) {
      return (
        <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground", className)} {...props} />
      );
    }
    return <code className={className} {...props} />;
  },
  CodeHeader: AcpCodeHeader,
});

/**
 * 流式 Markdown 文本部件（MessagePrimitive.Parts 的 Text 槽）。
 * - 文本取自 part 上下文，无需传参
 * - defer: 解析降优先级，token 流不阻塞输入/滚动
 * - smooth(默认开): 打字机揭示动效，prefers-reduced-motion 自动关
 */
export const AcpMarkdownText: TextMessagePartComponent = memo(() => {
  const components = useMemo(() => acpComponents, []);
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="text-sm leading-relaxed break-words text-foreground"
      components={components}
      defer
    />
  );
});
