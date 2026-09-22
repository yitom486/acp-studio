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
 *
 * Perf: shiki is NEVER statically imported here. The highlighter core,
 * the JavaScript regex engine (no oniguruma WASM), the two github themes,
 * and only the languages the app actually emits (see LANG_LOADERS) are
 * loaded via dynamic import() on first render. Everything else falls back
 * to plaintext with a loud console.warn — never a silent blank pane.
 */
import { useEffect, useMemo, useState } from "react";
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

/**
 * Short aliases / legacy ids -> canonical shiki language ids.
 * guessLanguage() already emits canonical ids; this covers direct callers.
 */
function normalizeLang(raw: string): string {
  const l = (raw || "").trim().toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    cts: "typescript",
    mts: "typescript",
    js: "javascript",
    cjs: "javascript",
    mjs: "javascript",
    jsx: "jsx",
    tsx: "tsx",
    md: "markdown",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    py: "python",
    rs: "rust",
    text: "plaintext",
    txt: "plaintext",
    plain: "plaintext",
  };
  return map[l] || l || "plaintext";
}

/**
 * On-demand language loaders. ONLY these ids ever enter the bundle —
 * each is a separate lazy chunk loaded via highlighter.loadLanguage().
 * Priority (per perf task): ts/tsx/js/json/md/diff/bash first; the rest
 * covers exactly what guessLanguage() in lib/universal-api can emit.
 * Anything else -> plaintext + loud console.warn (no silent fallback).
 */
const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  // Priority set
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  markdown: () => import("@shikijs/langs/markdown"),
  diff: () => import("@shikijs/langs/diff"),
  bash: () => import("@shikijs/langs/bash"),
  // guessLanguage() coverage
  mdx: () => import("@shikijs/langs/mdx"),
  python: () => import("@shikijs/langs/python"),
  rust: () => import("@shikijs/langs/rust"),
  go: () => import("@shikijs/langs/go"),
  css: () => import("@shikijs/langs/css"),
  html: () => import("@shikijs/langs/html"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  powershell: () => import("@shikijs/langs/powershell"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  java: () => import("@shikijs/langs/java"),
  csharp: () => import("@shikijs/langs/csharp"),
  sql: () => import("@shikijs/langs/sql"),
  xml: () => import("@shikijs/langs/xml"),
  vue: () => import("@shikijs/langs/vue"),
};

/**
 * NOTE: `plaintext`/`text` need no grammar module — shiki core treats them
 * as special plain-text languages natively (see isPlainLang), so they are
 * intentionally absent from LANG_LOADERS and never bundled.
 */

const THEME_LOADERS: Record<string, () => Promise<unknown>> = {
  "github-dark": () => import("@shikijs/themes/github-dark"),
  "github-light": () => import("@shikijs/themes/github-light"),
};

function unwrapGrammar(mod: unknown): unknown {
  const m = mod as { default?: unknown };
  return m?.default ?? mod;
}

// Singleton highlighter shared across all CodeComparison instances.
let highlighterPromise: Promise<any> | null = null;

async function getHighlighter(): Promise<any> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      // All dynamic — keeps shiki core + engine out of the main bundle
      // (manualChunks "shiki" in vite.config.ts) and avoids the
      // static+dynamic double-import Vite warning.
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, transformers] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
          import("@shikijs/transformers"),
        ]);
      void transformers; // loaded here so its chunk joins the shiki group
      const [darkMod, lightMod, tsMod] = await Promise.all([
        THEME_LOADERS["github-dark"](),
        THEME_LOADERS["github-light"](),
        LANG_LOADERS["typescript"](),
      ]);
      const hl = await createHighlighterCore({
        // Preload only typescript (plaintext needs no grammar); the rest loads on demand.
        langs: [unwrapGrammar(tsMod)] as any,
        themes: [unwrapGrammar(darkMod), unwrapGrammar(lightMod)] as any,
        engine: createJavaScriptRegexEngine(),
      });
      return hl;
    })().catch((err) => {
      // Loud, never silent: reset so a retry can happen on next open.
      console.error("[CodeComparison] shiki highlighter init failed, falling back to plaintext:", err);
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

async function ensureLanguage(hl: any, lang: string): Promise<string> {
  const normalized = normalizeLang(lang);
  if (normalized === "plaintext") return "plaintext";
  try {
    const loaded: string[] = typeof hl.getLoadedLanguages === "function" ? hl.getLoadedLanguages() : [];
    if (loaded.includes(normalized)) return normalized;
  } catch {
    // ignore introspection failure, try loading below
  }
  const loader = LANG_LOADERS[normalized];
  if (!loader) {
    console.warn(
      `[CodeComparison] unsupported language "${lang}" (normalized "${normalized}"), falling back to plaintext. Supported: ${Object.keys(LANG_LOADERS).join(", ")}`
    );
    return "plaintext";
  }
  try {
    const mod = await loader();
    await hl.loadLanguage(unwrapGrammar(mod) as any);
    return normalized;
  } catch (err) {
    console.warn(`[CodeComparison] language "${normalized}" failed to load, falling back to plaintext:`, err);
    return "plaintext";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      const fallbackBefore = `<pre>${escapeHtml(beforeCode)}</pre>`;
      const fallbackAfter = `<pre>${escapeHtml(afterCode)}</pre>`;
      try {
        // Dynamic-only imports: no static `shiki` / `@shikijs/transformers`
        // references remain in this file (fixes the Vite dual-import warning).
        const { transformerNotationDiff, transformerNotationFocus, transformerNotationHighlight } =
          await import("@shikijs/transformers");
        const hl = await getHighlighter();
        const effectiveLang = await ensureLanguage(hl, language);
        const effectiveTheme = THEME_LOADERS[selectedTheme] ? selectedTheme : "github-dark";
        if (effectiveTheme !== selectedTheme) {
          console.warn(
            `[CodeComparison] unsupported theme "${selectedTheme}", falling back to plaintext theme "github-dark"`
          );
        } else if (!THEME_LOADERS[selectedTheme]) {
          // unreachable by construction, kept loud for future theme props
        }
        // Load the requested theme on demand if it wasn't preloaded.
        try {
          const loadedThemes: string[] =
            typeof hl.getLoadedThemes === "function" ? hl.getLoadedThemes() : ["github-dark", "github-light"];
          if (!loadedThemes.includes(effectiveTheme)) {
            const themeMod = await THEME_LOADERS[effectiveTheme]();
            await hl.loadTheme(unwrapGrammar(themeMod) as any);
          }
        } catch (themeErr) {
          console.warn(`[CodeComparison] theme "${effectiveTheme}" failed to load, using preloaded theme:`, themeErr);
        }

        const before = hl.codeToHtml(beforeCode, {
          lang: effectiveLang,
          theme: effectiveTheme,
          transformers: [
            transformerNotationHighlight({ matchAlgorithm: "v3" }),
            transformerNotationDiff({ matchAlgorithm: "v3" }),
            transformerNotationFocus({ matchAlgorithm: "v3" }),
          ],
        });
        const after = hl.codeToHtml(afterCode, {
          lang: effectiveLang,
          theme: effectiveTheme,
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
        // Loud fallback per no-silent-fallbacks: plaintext + console.error.
        console.error("[CodeComparison] shiki highlight failed, showing plaintext fallback:", error);
        if (!cancelled) {
          setHighlightedBefore(fallbackBefore);
          setHighlightedAfter(fallbackAfter);
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
