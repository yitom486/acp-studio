/**
 * 只读 .ipynb 查看器：代码单元格用 Shiki 高亮，Markdown 单元格渲染，输出支持文本 / 图片 / 报错，
 * HTML 输出放进 sandbox iframe（不允许脚本、同源访问、弹窗、导航）。
 * 大笔记本：分批挂载（滚到底再加载下一批）+ content-visibility:auto 跳过屏幕外单元格的渲染。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseNotebook, type CellView, type OutputView } from "@/lib/notebook";
import { getHighlighter, ensureLanguage } from "@/components/magicui/code-comparison";
import { useThemeStore } from "@/stores/useThemeStore";
import { hasMath } from "@/lib/markdown-preprocess";
import { getMathPlugins, loadMathPlugins } from "@/components/assistant/math-plugins";
import { cn } from "@/lib/utils";

const BATCH = 40;

const Code: React.FC<{ code: string; lang: string }> = ({ code, lang }) => {
  const theme = useThemeStore((s) => s.theme);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const hl = await getHighlighter();
        const l = await ensureLanguage(hl, lang);
        const out = hl.codeToHtml(code, { lang: l, theme: theme === "light" ? "github-light-high-contrast" : "github-dark-default" });
        if (!off) setHtml(out);
      } catch {
        if (!off) setHtml(null);
      }
    })();
    return () => {
      off = true;
    };
  }, [code, lang, theme]);
  if (!html) return <pre className="nb-code font-mono text-[12.5px] whitespace-pre-wrap">{code}</pre>;
  return <div className="nb-code text-[12.5px] [&_pre]:!bg-transparent [&_pre]:whitespace-pre-wrap [&_pre]:font-mono" dangerouslySetInnerHTML={{ __html: html }} />;
};

const Md: React.FC<{ text: string }> = ({ text }) => {
  const needs = useMemo(() => hasMath(text), [text]);
  const [math, setMath] = useState(getMathPlugins());
  useEffect(() => {
    if (needs && !math) void loadMathPlugins().then(setMath);
  }, [needs, math]);
  const use = needs && math;
  return (
    <div className="acp-md nb-md text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={use ? [remarkGfm, ...math!.remark] : [remarkGfm]} rehypePlugins={use ? math!.rehype : []} skipHtml>
        {use ? math!.preprocess(text) : text}
      </ReactMarkdown>
    </div>
  );
};

const Output: React.FC<{ o: OutputView }> = ({ o }) => {
  switch (o.kind) {
    case "text":
      return <pre className={cn("whitespace-pre-wrap font-mono text-[12px]", o.stream === "stderr" && "text-destructive")}>{o.text}</pre>;
    case "image":
      return <img src={o.src} alt={o.mime} className="max-w-full rounded border border-border bg-white" />;
    case "html":
      return (
        <iframe
          title="HTML 输出"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{font:13px system-ui;margin:8px;color:#111;background:#fff}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:2px 6px}</style>${o.html}`}
          className="h-64 w-full resize-y rounded border border-border bg-white"
        />
      );
    case "markdown":
      return <Md text={o.text} />;
    case "error":
      return (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2">
          <div className="font-mono text-[12px] font-semibold text-destructive">{o.ename}: {o.evalue}</div>
          {o.traceback && <pre className="mt-1 whitespace-pre-wrap font-mono text-[11.5px] text-muted-foreground">{o.traceback}</pre>}
        </div>
      );
    default:
      return <div className="text-[11px] text-muted-foreground">（暂不支持的输出类型：{o.mimes.join(", ")}）</div>;
  }
};

const Cell: React.FC<{ c: CellView; lang: string }> = ({ c, lang }) => (
  <div className="nb-cell flex gap-3 py-2" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 120px" }} data-cell={c.index}>
    <div className="w-14 shrink-0 pt-2 text-right font-mono text-[11px] text-muted-foreground">
      {c.type === "code" ? `[${c.executionCount ?? " "}]` : ""}
    </div>
    <div className="min-w-0 flex-1 space-y-2">
      {c.type === "code" ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2"><Code code={c.source} lang={lang} /></div>
      ) : c.type === "markdown" ? (
        <Md text={c.source} />
      ) : (
        <pre className="whitespace-pre-wrap font-mono text-[12px] text-muted-foreground">{c.source}</pre>
      )}
      {c.outputs.length > 0 && (
        <div className="space-y-2 border-l-2 border-border pl-3">
          {c.outputs.map((o, i) => <Output key={i} o={o} />)}
        </div>
      )}
    </div>
  </div>
);

export const NotebookViewer: React.FC<{ text: string }> = ({ text }) => {
  const parsed = useMemo(() => {
    try {
      return { nb: parseNotebook(text), error: null as string | null };
    } catch (e) {
      return { nb: null, error: (e as Error).message };
    }
  }, [text]);
  const [count, setCount] = useState(BATCH);
  const sentinel = useRef<HTMLDivElement>(null);
  const total = parsed.nb?.cells.length ?? 0;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || count >= total) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setCount((c) => Math.min(total, c + BATCH)), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [count, total]);
  if (parsed.error) return <div className="p-4 text-xs text-destructive">{parsed.error}</div>;
  const nb = parsed.nb!;
  return (
    <div className="h-full overflow-y-auto px-4 py-3" data-notebook>
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded border border-border px-1.5 py-0.5 font-mono">Jupyter · {nb.language}</span>
        <span>{total} 个单元格 · 只读（不运行内核）</span>
      </div>
      {nb.cells.slice(0, count).map((c) => <Cell key={c.index} c={c} lang={nb.language} />)}
      {count < total && <div ref={sentinel} className="py-4 text-center text-xs text-muted-foreground">正在加载更多单元格…（{count}/{total}）</div>}
    </div>
  );
};

export default NotebookViewer;
