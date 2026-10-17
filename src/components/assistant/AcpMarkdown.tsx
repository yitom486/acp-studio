import React, { Suspense, lazy, memo, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  MarkdownTextPrimitive,
  memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
  type CodeHeaderProps,
} from "@assistant-ui/react-markdown";
import "@assistant-ui/react-markdown/styles/dot.css";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import ReactMarkdown from "react-markdown";
import { Check, Copy, Info, Lightbulb, AlertCircle, AlertTriangle, ShieldAlert } from "lucide-react";
import { useMessagePartText, type TextMessagePartComponent } from "@assistant-ui/react";
import { closeOpenFences, hasMath, preprocessMarkdown } from "@/lib/markdown-preprocess";
import { getMathPlugins, loadMathPlugins, subscribeMath } from "@/components/assistant/math-plugins";
import { useDeviceFps } from "@/lib/fps-adaptive";
import { cn } from "@/lib/utils";
import { AcpImageView, isSafeLinkHref, isSafeMediaSrc } from "@/components/assistant/AcpMedia";
import { Citation } from "@/components/primitives/Citations";
import { getHighlighter, ensureLanguage } from "@/components/magicui/code-comparison";
import { useThemeStore } from "@/stores/useThemeStore";

const ReactArtifactCard = lazy(() =>
  import("./ReactArtifactCard").then((m) => ({ default: m.ReactArtifactCard }))
);

export const AcpCodeHeader: React.FC<CodeHeaderProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const cleanLang = (language || "").toLowerCase().trim();
  const isPreviewable = cleanLang === "react" || cleanLang === "tsx" || cleanLang === "jsx" || cleanLang === "html";

  const copy = () => {
    if (!code || copied) return;
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-border bg-background/80 px-3 py-1 text-[11px] font-mono text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>{language || "code"}</span>
          {isPreviewable && (
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-sans font-medium transition-colors flex items-center gap-1",
                showPreview
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground hover:bg-primary/20"
              )}
              title={showPreview ? "切回代码视图" : "实时渲染并预览此交互组件"}
            >
              <span>{showPreview ? "查看源码" : "运行预览"}</span>
            </button>
          )}
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
          title="复制代码"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>

      {showPreview && isPreviewable && (
        <Suspense
          fallback={
            <div className="p-3 text-xs text-muted-foreground animate-pulse border border-border bg-background/60">
              沙箱加载中…
            </div>
          }
        >
          <ReactArtifactCard
            code={code}
            template={cleanLang === "html" ? "html" : "react"}
            title={`${language} 原型预览`}
            className="rounded-t-none mt-0 border-t-0"
          />
        </Suspense>
      )}
    </div>
  );
};

export const AcpSyntaxHighlighter: React.FC<{
  language?: string;
  code: string;
}> = ({ language, code }) => {
  const theme = useThemeStore((s) => s.theme);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const cleanLang = (language || "").split(/\s+/)[0]?.toLowerCase().trim() || "plaintext";

    // 节流防抖：在流式输出期间（高达 180~240 帧/秒），避免重度 Shiki 语法树在每一帧都阻塞主线程，
    // 75ms 节流窗口内由原生的 pre/code 无闪烁同帧渲染，停顿或完成后无缝过渡至完整高亮 HTML。
    const timer = setTimeout(async () => {
      try {
        const hl = await getHighlighter();
        const l = await ensureLanguage(hl, cleanLang);
        const shikiTheme = theme === "light" ? "github-light-high-contrast" : "github-dark-default";
        const out = hl.codeToHtml(code, {
          lang: l,
          theme: shikiTheme,
        });
        if (active) setHighlighted(out);
      } catch {
        if (active) setHighlighted(null);
      }
    }, 75);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [code, language, theme]);

  if (!highlighted) {
    return (
      <pre className="overflow-x-auto rounded-b-lg border border-t-0 border-border bg-background/80 px-3 py-2.5 text-xs leading-relaxed font-mono text-foreground select-text">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      data-testid="acp-highlighted-code"
      className="overflow-x-auto rounded-b-lg border border-t-0 border-border bg-background/80 px-3 py-2.5 text-xs leading-relaxed font-mono text-foreground [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_pre]:!border-0 [&_code]:!bg-transparent [&_code]:!p-0 select-text"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
};

const ALERT_STYLES: Record<string, {
  border: string;
  bg: string;
  text: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}> = {
  NOTE: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/10",
    text: "text-blue-500",
    icon: Info,
    label: "Note",
  },
  TIP: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
    text: "text-emerald-500",
    icon: Lightbulb,
    label: "Tip",
  },
  IMPORTANT: {
    border: "border-purple-500/30",
    bg: "bg-purple-500/10",
    text: "text-purple-500",
    icon: AlertCircle,
    label: "Important",
  },
  WARNING: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    text: "text-amber-500",
    icon: AlertTriangle,
    label: "Warning",
  },
  CAUTION: {
    border: "border-rose-500/30",
    bg: "bg-rose-500/10",
    text: "text-rose-500",
    icon: ShieldAlert,
    label: "Caution",
  },
};

export const AcpBlockquote: React.FC<{ className?: string; children?: React.ReactNode }> = ({ className, children, ...props }) => {
  const childArray = React.Children.toArray(children);
  const contentChildren = childArray.filter(
    (c) => typeof c !== "string" || c.trim().length > 0
  );
  const firstChild = contentChildren[0];

  if (React.isValidElement(firstChild) && (firstChild.props as any)?.children) {
    const pChildren = React.Children.toArray((firstChild.props as any).children);
    const firstText = typeof pChildren[0] === "string" ? pChildren[0] : "";
    const match = firstText.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(\n)?/i);

    if (match) {
      const alertType = match[1].toUpperCase();
      const style = ALERT_STYLES[alertType] || ALERT_STYLES.NOTE;
      const Icon = style.icon;
      const restText = firstText.slice(match[0].length);
      const remainingPChildren = restText ? [restText, ...pChildren.slice(1)] : pChildren.slice(1);
      const newFirstChild = React.cloneElement(firstChild as React.ReactElement<any>, {}, ...remainingPChildren);
      const otherChildren = contentChildren.slice(1);

      return (
        <div
          data-alert={alertType.toLowerCase()}
          className={cn(
            "my-3 rounded-lg border px-3.5 py-2.5 text-xs text-foreground shadow-xs leading-relaxed",
            style.border,
            style.bg,
            className
          )}
          {...props}
        >
          <div className={cn("flex items-center gap-1.5 font-semibold text-[12px] mb-1 select-none", style.text)}>
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{style.label}</span>
          </div>
          <div className="space-y-1.5 [&>p]:my-1">
            {newFirstChild}
            {otherChildren}
          </div>
        </div>
      );
    }
  }

  return (
    <blockquote
      className={cn("my-2 border-l-2 border-primary/50 pl-3 text-muted-foreground italic", className)}
      {...props}
    >
      {children}
    </blockquote>
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
  blockquote: AcpBlockquote,
  a: ({ className, href, children, ...props }: any) => {
    if (!isSafeLinkHref(href)) {
      return <span className="text-muted-foreground">{children}</span>;
    }
    const text = typeof children === "string" ? children.trim() : Array.isArray(children) ? children.join("").trim() : "";
    const citationMatch = text.match(/^\[?(\d+)\]?$/);
    if (citationMatch) {
      const idx = parseInt(citationMatch[1], 10);
      return (
        <Citation
          citationId={`ref-${idx}`}
          index={idx}
          idPrefix="source"
          label={`查看引用 ${idx}`}
          className={className}
        />
      );
    }
    return (
      <a
        className={cn("text-primary underline-offset-2 hover:underline", className)}
        target="_blank"
        rel="noreferrer"
        href={href}
        {...props}
      >
        {children}
      </a>
    );
  },
  strong: ({ className, ...props }: any) => (
    <strong className={cn("font-semibold", className)} {...props} />
  ),
  b: ({ className, ...props }: any) => (
    <b className={cn("font-semibold", className)} {...props} />
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
  img: function AcpImg({ src, alt }: any) {
    if (!isSafeMediaSrc(src)) {
      return (
        <span className="text-muted-foreground text-xs">
          {typeof alt === "string" && alt ? alt : "（已拦截不安全图片地址）"}
        </span>
      );
    }
    return <AcpImageView src={src} alt={typeof alt === "string" ? alt : undefined} />;
  },
  kbd: ({ className, ...props }: any) => (
    <kbd
      className={cn(
        "inline-flex items-center justify-center font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded border border-border bg-muted/80 text-foreground shadow-xs select-all mx-0.5 align-middle tracking-tight",
        className
      )}
      {...props}
    />
  ),
  mark: ({ className, ...props }: any) => (
    <mark className={cn("bg-primary/20 text-foreground px-1 py-0.5 rounded font-medium", className)} {...props} />
  ),
  del: ({ className, ...props }: any) => (
    <del className={cn("line-through opacity-70", className)} {...props} />
  ),
  s: ({ className, ...props }: any) => (
    <s className={cn("line-through opacity-70", className)} {...props} />
  ),
  ins: ({ className, ...props }: any) => (
    <ins className={cn("underline underline-offset-2 decoration-primary", className)} {...props} />
  ),
  u: ({ className, ...props }: any) => (
    <u className={cn("underline underline-offset-2", className)} {...props} />
  ),
  sub: ({ className, ...props }: any) => (
    <sub className={cn("text-[10px] align-sub", className)} {...props} />
  ),
  sup: ({ className, ...props }: any) => (
    <sup className={cn("text-[10px] align-super", className)} {...props} />
  ),
  abbr: ({ className, ...props }: any) => (
    <abbr
      className={cn("underline decoration-dotted underline-offset-4 cursor-help", className)}
      {...props}
    />
  ),
  details: ({ className, ...props }: any) => (
    <details
      className={cn(
        "my-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs transition-colors open:bg-muted/50",
        className
      )}
      {...props}
    />
  ),
  summary: ({ className, ...props }: any) => (
    <summary
      className={cn(
        "font-medium text-foreground cursor-pointer select-none outline-none py-0.5 hover:text-primary transition-colors flex items-center gap-1.5",
        className
      )}
      {...props}
    />
  ),
  span: ({ className, ...props }: any) => <span className={className} {...props} />,
  div: ({ className, ...props }: any) => <div className={className} {...props} />,
  section: ({ className, ...props }: any) => <section className={className} {...props} />,
  CodeHeader: AcpCodeHeader,
  SyntaxHighlighter: AcpSyntaxHighlighter,
});

/**
 * 流式 Markdown 文本部件（MessagePrimitive.Parts 的 Text 槽）。
 * - 文本取自 part 上下文，无需传参
 * - defer: 解析降优先级，token 流不阻塞输入/滚动
 * - smooth(默认开): 打字机揭示动效，prefers-reduced-motion 自动关
 * - componentsByLanguage.mermaid: 图表走懒加载渲染器（与引擎无关，
 *   streamdown 同理也要另装插件；此处直接注册即可）
 */
const AcpMermaidDiagram = lazy(() => import("./AcpMermaidDiagram"));

const MermaidBlock: React.FC<{ code: string }> = ({ code }) => (
  <div data-mermaid-block>
    <Suspense
      fallback={
        <div
          className="my-2 flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-4 text-xs text-muted-foreground"
          role="status"
        >
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
          <span className="animate-pulse">图表组件加载中…</span>
        </div>
      }
    >
      <AcpMermaidDiagram code={code} />
    </Suspense>
  </div>
);

const ReactPreviewBlock: React.FC<{ code: string }> = ({ code }) => (
  <Suspense
    fallback={
      <div className="my-2 p-3 text-xs text-muted-foreground animate-pulse border border-border rounded-lg bg-background/60">
        正在挂载沙箱组件…
      </div>
    }
  >
    <ReactArtifactCard code={code} template="react" />
  </Suspense>
);

const HtmlPreviewBlock: React.FC<{ code: string }> = ({ code }) => (
  <Suspense
    fallback={
      <div className="my-2 p-3 text-xs text-muted-foreground animate-pulse border border-border rounded-lg bg-background/60">
        正在挂载 HTML 沙箱…
      </div>
    }
  >
    <ReactArtifactCard code={code} template="html" />
  </Suspense>
);

const customByLanguage = {
  mermaid: { SyntaxHighlighter: MermaidBlock },
  "react-preview": { SyntaxHighlighter: ReactPreviewBlock },
  "tsx-preview": { SyntaxHighlighter: ReactPreviewBlock },
  "jsx-preview": { SyntaxHighlighter: ReactPreviewBlock },
  "html-preview": { SyntaxHighlighter: HtmlPreviewBlock },
  "ui-preview": { SyntaxHighlighter: ReactPreviewBlock },
};

const BASE_REMARK = [remarkGfm];
const BASE_REHYPE = [rehypeRaw];
const fencesOnly = (t: string) => closeOpenFences(t);

export const AcpMarkdownText: TextMessagePartComponent = memo(() => {
  const components = useMemo(() => acpComponents, []);
  const byLanguage = useMemo(() => customByLanguage, []);
  const { smoothOptions } = useDeviceFps();
  const { text } = useMessagePartText();
  const math = useSyncExternalStore(subscribeMath, getMathPlugins, getMathPlugins);
  const needsMath = useMemo(() => hasMath(text), [text]);
  useEffect(() => {
    if (needsMath && !math) void loadMathPlugins();
  }, [needsMath, math]);
  const useMath = needsMath && !!math;
  const remarkPlugins = useMemo(() => (useMath ? [...BASE_REMARK, ...math!.remark] : BASE_REMARK), [useMath, math]);
  const rehypePlugins = useMemo(() => (useMath ? [rehypeRaw, ...math!.rehype] : BASE_REHYPE), [useMath, math]);
  const preprocess = useMemo(() => (useMath ? (t: string) => preprocessMarkdown(math!.preprocess(t)) : preprocessMarkdown), [useMath, math]);
  return (
    <MarkdownTextPrimitive
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      preprocess={preprocess}
      className="acp-md text-sm leading-relaxed break-words text-foreground"
      components={components}
      componentsByLanguage={byLanguage}
      smooth={smoothOptions}
    />
  );
});

export interface AcpStandaloneMarkdownProps {
  content: string;
  className?: string;
}

/**
 * 独立 Markdown 渲染器（用于阶段推进记录折叠区、独立弹窗等无需 assistant-ui PartContext 的场景）。
 * 完整支持 GFM 表格、Shiki 高亮代码块、GitHub Alert 呼出框及安全 HTML 标签。
 */
export const AcpStandaloneMarkdown: React.FC<AcpStandaloneMarkdownProps> = memo(({ content, className }) => {
  const math = useSyncExternalStore(subscribeMath, getMathPlugins, getMathPlugins);
  const needsMath = useMemo(() => hasMath(content), [content]);
  useEffect(() => {
    if (needsMath && !math) void loadMathPlugins();
  }, [needsMath, math]);
  const useMath = needsMath && !!math;
  const remarkPlugins = useMemo(() => (useMath ? [...BASE_REMARK, ...math!.remark] : BASE_REMARK), [useMath, math]);
  const rehypePlugins = useMemo(() => (useMath ? [rehypeRaw, ...math!.rehype] : BASE_REHYPE), [useMath, math]);
  const processed = useMemo(() => (useMath ? preprocessMarkdown(math!.preprocess(content)) : preprocessMarkdown(content)), [useMath, math, content]);

  return (
    <div className={cn("acp-md text-xs leading-relaxed break-words text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          ...(acpComponents as any),
          pre: ({ children }: any) => <div className="my-1.5">{children}</div>,
          code: function StandaloneCode({ className: codeClassName, children, ...props }: any) {
            const match = /language-(\w+)/.exec(codeClassName || "");
            const codeString = String(children || "").replace(/\n$/, "");
            if (match) {
              const lang = match[1];
              return (
                <div className="my-1.5 overflow-hidden rounded-lg border border-border">
                  <AcpCodeHeader language={lang} code={codeString} />
                  <AcpSyntaxHighlighter language={lang} code={codeString} />
                </div>
              );
            }
            return (
              <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground", codeClassName)} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
});

