import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="rounded-lg border border-border bg-background/80 overflow-hidden my-2">
      <div className="flex items-center justify-between px-3 py-1 border-b border-border text-[11px] font-mono text-muted-foreground">
        <span>{language || "code"}</span>
        <button onClick={copy} className="flex items-center gap-1 hover:text-foreground transition-colors" title="复制代码">
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="px-3 py-2.5 overflow-x-auto text-xs leading-relaxed font-mono text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const components = {
  h1: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="text-base font-bold text-foreground mt-3 mb-1.5" {...props} />
  ),
  h2: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="text-[15px] font-bold text-foreground mt-3 mb-1.5" {...props} />
  ),
  h3: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-sm font-bold text-foreground mt-2.5 mb-1" {...props} />
  ),
  h4: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4 className="text-[13px] font-bold text-foreground mt-2 mb-1" {...props} />
  ),
  p: ({ ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="my-1.5 leading-relaxed" {...props} />
  ),
  ul: ({ ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="my-1.5 ml-4 list-disc space-y-1 marker:text-muted-foreground" {...props} />
  ),
  ol: ({ ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="my-1.5 ml-4 list-decimal space-y-1 marker:text-muted-foreground" {...props} />
  ),
  li: ({ ...props }: React.HTMLAttributes<HTMLLIElement>) => <li className="leading-relaxed" {...props} />,
  blockquote: ({ ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="my-2 border-l-2 border-primary/50 pl-3 text-muted-foreground" {...props} />
  ),
  a: ({ ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer" {...props} />
  ),
  strong: ({ ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
  hr: ({ ...props }: React.HTMLAttributes<HTMLHRElement>) => (
    <hr className="my-3 border-border" {...props} />
  ),
  table: ({ ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs" {...props} />
    </div>
  ),
  thead: ({ ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-muted/60" {...props} />
  ),
  th: ({ ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="px-2.5 py-1.5 text-left font-semibold text-foreground border-b border-border" {...props} />
  ),
  td: ({ ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="px-2.5 py-1.5 border-b border-border/60 align-top" {...props} />
  ),
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) => {
    const text = String(children ?? "").replace(/\n$/, "");
    const match = /language-(\w+)/.exec(className || "");
    const isBlock = !!match || text.includes("\n");
    if (!isBlock) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock language={match?.[1] || ""} code={text} />;
  },
};

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed break-words text-foreground", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
