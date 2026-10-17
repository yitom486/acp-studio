/**
 * CodeMirror 6 公共配置：主题完全用应用的 CSS 变量（hsl(var(--x))），所以四档主题切换、
 * View Transitions 交叉淡化时编辑器自动跟随，无需重建编辑器。
 */
import { EditorView, Decoration, type DecorationSet, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, rectangularSelection } from "@codemirror/view";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";

const v = (name: string, alpha?: number) => (alpha == null ? `hsl(var(--${name}))` : `hsl(var(--${name}) / ${alpha})`);

export const acpEditorTheme = EditorView.theme({
  "&": { color: v("foreground"), backgroundColor: v("background"), height: "100%", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { caretColor: v("foreground"), padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: v("foreground"), borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: `${v("foreground", 0.16)} !important` },
  ".cm-activeLine": { backgroundColor: v("foreground", 0.035) },
  ".cm-gutters": { backgroundColor: v("background"), color: v("muted-foreground", 0.7), border: "none", borderRight: `1px solid ${v("border")}` },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: v("foreground") },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px" },
  ".cm-foldPlaceholder": { backgroundColor: v("muted"), border: `1px solid ${v("border")}`, color: v("muted-foreground") },
  ".cm-matchingBracket": { backgroundColor: v("foreground", 0.1), outline: `1px solid ${v("foreground", 0.25)}` },
  ".cm-searchMatch": { backgroundColor: v("warning", 0.25) },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: v("warning", 0.45) },
  ".cm-selectionMatch": { backgroundColor: v("foreground", 0.08) },
  ".cm-panels": { backgroundColor: v("card"), color: v("foreground"), borderTop: `1px solid ${v("border")}` },
  ".cm-panels input, .cm-panels button": { fontSize: "12px" },
  ".cm-tooltip": { backgroundColor: v("popover"), color: v("popover-foreground"), border: `1px solid ${v("border")}` },
  // AI / 外部修改后重载的行：短暂高亮然后淡出
  ".cm-ai-flash": { animation: "acp-ai-flash 2.6s ease-out forwards" },
  // diff（@codemirror/merge）
  ".cm-changedLine, &.cm-merge-b .cm-changedLine": { backgroundColor: v("success", 0.1) },
  "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": { backgroundColor: v("destructive", 0.1) },
  ".cm-changedText, &.cm-merge-b .cm-changedText": { background: v("success", 0.28) },
  "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText": { background: v("destructive", 0.28) },
  ".cm-merge-gap": { backgroundColor: v("muted") },
  ".cm-collapsedLines": { color: v("muted-foreground"), background: v("muted") },
});

export const acpHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword], color: "var(--syntax-keyword)", fontWeight: "600" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syntax-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syntax-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: "var(--syntax-function)" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: "var(--syntax-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--syntax-property)" },
  { tag: [t.tagName], color: "var(--syntax-tag)" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--syntax-variable)" },
  { tag: [t.heading], fontWeight: "700", color: "var(--syntax-variable)" },
  { tag: [t.link, t.url], color: "var(--syntax-keyword)", textDecoration: "underline" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "700" },
  { tag: [t.punctuation, t.bracket, t.operator], color: "var(--syntax-punctuation)" },
  { tag: t.invalid, color: "hsl(var(--destructive))" },
]);

/** 高亮一组行（1-based），用于 AI 改动后的闪烁提示 */
export const setFlashLines = StateEffect.define<number[]>();
const flashMark = Decoration.line({ class: "cm-ai-flash" });
export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFlashLines)) {
        const doc = tr.state.doc;
        const ranges = e.value
          .filter((n) => n >= 1 && n <= doc.lines)
          .map((n) => flashMark.range(doc.line(n).from));
        deco = Decoration.set(ranges, true);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function baseExtensions(opts: { readOnly?: boolean } = {}): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    syntaxHighlighting(acpHighlight),
    acpEditorTheme,
    flashField,
    EditorState.readOnly.of(!!opts.readOnly),
    EditorView.editable.of(!opts.readOnly),
  ];
}

/** 按扩展名按需加载语言包（各自独立 chunk） */
export async function languageFor(path: string): Promise<Extension | null> {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts": case "mts": case "cts":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true });
    case "js": case "mjs": case "cjs":
      return (await import("@codemirror/lang-javascript")).javascript();
    case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "json": case "jsonc":
      return (await import("@codemirror/lang-json")).json();
    case "md": case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "css": case "scss": case "less":
      return (await import("@codemirror/lang-css")).css();
    case "html": case "htm": case "vue": case "svelte":
      return (await import("@codemirror/lang-html")).html();
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    case "yml": case "yaml":
      return (await import("@codemirror/lang-yaml")).yaml();
    default:
      return null;
  }
}
