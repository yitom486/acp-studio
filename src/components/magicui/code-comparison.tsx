/**
 * Port of Magic UI "Code Comparison" (registry/magicui/code-comparison).
 * Adaptations for this repo (see .agents/rules/ui_design.md):
 * - dropped `next-themes`: app is dark-only, theme fixed via `theme` prop
 *   (defaults to the official darkTheme);
 * - diff row washes use semantic tokens (bg-success/15, bg-destructive/15)
 *   instead of the upstream rgba literals;
 * - chrome (borders, headers) retokened border-border/bg-muted to match the
 *   blue-gray theme; layout otherwise verbatim from upstream
 *   (before/after panes, VS badge, focus-blur, shiki notation transformers).
 */
import { useEffect, useMemo, useState } from "react";
import {
  transformerNotationDiff,
  transformerNotationFocus,
} from "@shikijs/transformers";
import { FileIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface CodeComparisonProps {
  beforeCode: string;
  afterCode: string;
  language: string;
  filename: string;
  lightTheme?: string;
  darkTheme?: string;
  highlightColor?: string;
  theme?: "light" | "dark";
}

export function CodeComparison({
  beforeCode,
  afterCode,
  language,
  filename,
  lightTheme = "github-light",
  darkTheme = "github-dark",
  highlightColor = "#ff3333",
  theme = "dark",
}: CodeComparisonProps) {
  const [highlightedBefore, setHighlightedBefore] = useState("");
  const [highlightedAfter, setHighlightedAfter] = useState("");
  const [hasLeftFocus, setHasLeftFocus] = useState(false);
  const [hasRightFocus, setHasRightFocus] = useState(false);

  const selectedTheme = useMemo(
    () => (theme === "dark" ? darkTheme : lightTheme),
    [theme, darkTheme, lightTheme]
  );

  useEffect(() => {
    if (highlightedBefore || highlightedAfter) {
      setHasLeftFocus(highlightedBefore.includes('class="line focused"'));
      setHasRightFocus(highlightedAfter.includes('class="line focused"'));
    }
  }, [highlightedBefore, highlightedAfter]);

  useEffect(() => {
    let cancelled = false;
    async function highlightCode() {
      try {
        const { codeToHtml } = await import("shiki");
        const { transformerNotationHighlight } =
          await import("@shikijs/transformers");

        const before = await codeToHtml(beforeCode, {
          lang: language,
          theme: selectedTheme,
          transformers: [
            transformerNotationHighlight({ matchAlgorithm: "v3" }),
            transformerNotationDiff({ matchAlgorithm: "v3" }),
            transformerNotationFocus({ matchAlgorithm: "v3" }),
          ],
        });
        const after = await codeToHtml(afterCode, {
          lang: language,
          theme: selectedTheme,
          transformers: [
            transformerNotationHighlight({ matchAlgorithm: "v3" }),
            transformerNotationFocus({ matchAlgorithm: "v3" }),
            transformerNotationDiff({ matchAlgorithm: "v3" }),
          ],
        });
        if (!cancelled) {
          setHighlightedBefore(before);
          setHighlightedAfter(after);
        }
      } catch (error) {
        console.error("Error highlighting code:", error);
        if (!cancelled) {
          setHighlightedBefore(`<pre>${beforeCode}</pre>`);
          setHighlightedAfter(`<pre>${afterCode}</pre>`);
        }
      }
    }
    highlightCode();
    return () => {
      cancelled = true;
    };
  }, [beforeCode, afterCode, language, selectedTheme]);

  const renderCode = (code: string, highlighted: string) => {
    if (highlighted) {
      return (
        <div
          style={{ "--highlight-color": highlightColor } as React.CSSProperties}
          className={cn(
            "bg-background h-full w-full overflow-auto font-mono text-xs",
            "[&>pre]:h-full [&>pre]:w-screen! [&>pre]:py-2",
            "[&>pre>code]:inline-block! [&>pre>code]:w-full!",
            "[&>pre>code>span]:inline-block! [&>pre>code>span]:w-full [&>pre>code>span]:px-4 [&>pre>code>span]:py-0.5",
            "[&>pre>code>.highlighted]:inline-block [&>pre>code>.highlighted]:w-full [&>pre>code>.highlighted]:bg-(--highlight-color)!",
            "group-hover/left:[&>pre>code>:not(.focused)]:opacity-100! group-hover/left:[&>pre>code>:not(.focused)]:blur-none!",
            "group-hover/right:[&>pre>code>:not(.focused)]:opacity-100! group-hover/right:[&>pre>code>:not(.focused)]:blur-none!",
            "[&>pre>code>.add]:bg-success/15 [&>pre>code>.remove]:bg-destructive/15",
            "group-hover/left:[&>pre>code>:not(.focused)]:transition-all group-hover/left:[&>pre>code>:not(.focused)]:duration-300",
            "group-hover/right:[&>pre>code>:not(.focused)]:transition-all group-hover/right:[&>pre>code>:not(.focused)]:duration-300"
          )}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      );
    } else {
      return (
        <pre className="bg-background text-foreground h-full overflow-auto p-4 font-mono text-xs break-all">
          {code}
        </pre>
      );
    }
  };

  return (
    <div className="mx-auto w-full">
      <div className="group border-border relative w-full overflow-hidden rounded-md border">
        <div className="relative grid md:grid-cols-2">
          <div
            className={cn(
              "leftside group/left border-border md:border-r",
              hasLeftFocus &&
                "[&>div>pre>code>:not(.focused)]:opacity-50! [&>div>pre>code>:not(.focused)]:blur-[0.095rem]!",
              "[&>div>pre>code>:not(.focused)]:transition-all [&>div>pre>code>:not(.focused)]:duration-300"
            )}
          >
            <div className="border-border bg-muted text-foreground flex items-center border-b p-2 text-sm">
              <FileIcon className="mr-2 h-4 w-4" />
              {filename}
              <span className="ml-auto hidden md:block">before</span>
            </div>
            {renderCode(beforeCode, highlightedBefore)}
          </div>
          <div
            className={cn(
              "rightside group/right border-border border-t md:border-t-0",
              hasRightFocus &&
                "[&>div>pre>code>:not(.focused)]:opacity-50! [&>div>pre>code>:not(.focused)]:blur-[0.095rem]!",
              "[&>div>pre>code>:not(.focused)]:transition-all [&>div>pre>code>:not(.focused)]:duration-300"
            )}
          >
            <div className="border-border bg-muted text-foreground flex items-center border-b p-2 text-sm">
              <FileIcon className="mr-2 h-4 w-4" />
              {filename}
              <span className="ml-auto hidden md:block">after</span>
            </div>
            {renderCode(afterCode, highlightedAfter)}
          </div>
        </div>
        <div className="border-border bg-muted text-foreground absolute top-1/2 left-1/2 hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border text-xs md:flex">
          VS
        </div>
      </div>
    </div>
  );
}
