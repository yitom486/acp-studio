/**
 * 聊天 Markdown 预处理（纯函数，可单测）。
 * - closeOpenFences：流式输出时代码块还没收尾 → 临时补上结束围栏，并去掉末尾半截的 ``` 行，
 *   避免出现裸露的反引号或后面的正文被吞进代码块后又跳回来。
 * - hasMath：是否包含数学公式（决定是否按需加载 KaTeX）。
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function closeOpenFences(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  // 末行是正在输入的半截围栏（`、`` 或只有 ``` 加不完整的语言名也没关系）
  const last = lines[lines.length - 1];
  if (/^ {0,3}`{1,2}$/.test(last)) lines.pop();
  let open: string | null = null;
  for (const l of lines) {
    const m = l.match(FENCE);
    if (!m) continue;
    const marker = m[1];
    if (!open) open = marker;
    else if (marker[0] === open[0] && marker.length >= open.length && l.trim() === marker) open = null;
  }
  const body = lines.join("\n");
  return open ? `${body}${body.endsWith("\n") ? "" : "\n"}${open}` : body;
}

/** $$…$$、\[…\]、\(…\) 或成对的 $x$（不匹配价格如 $5 / $10） */
export function hasMath(text: string): boolean {
  if (!text) return false;
  if (/\$\$[\s\S]+?\$\$/.test(text) || /\\\[[\s\S]+?\\\]/.test(text) || /\\\([\s\S]+?\\\)/.test(text)) return true;
  return /(^|[^\\$\w])\$(?!\s)[^$\n]*[^\s$\d][^$\n]*?(?<!\s)\$(?![\w$])/.test(text);
}

/**
 * 规范化 LLM 输出中常见的不符合 CommonMark 右侧边界规范的粗体/斜体定界符：
 * 例如 `出于**防止用户硬件指纹追踪 (Anti-Fingerprinting) **的隐`
 * CommonMark 规定右侧定界符前不得有空格，否则退化为普通星号。
 * 本函数在保护围栏代码块和行内代码的前提下，将内部多余的首尾空格移出定界符外，
 * 确保所有模型输出的强调文本 100% 稳定被解析为 <strong> / <em>。
 */
export function normalizeLooseEmphasis(text: string): string {
  if (!text) return text;
  // 1. 规范化不对称的 3星 vs 2星 强调（如 LLM 输出 ***“电量杀手”** 或 **“电量杀手”*** 导致漏解析并裸露单个星号）
  let normalized = text.replace(
    /(```[\s\S]*?```|`[^`\n]*`)|((?:^|[^*])\*{3}([^*\r\n]+?)\*{2}(?:[^*]|$))|((?:^|[^*])\*{2}([^*\r\n]+?)\*{3}(?:[^*]|$))/g,
    (match, code, _asym1, inner1, _asym2, inner2) => {
      if (code) return code;
      if (inner1) {
        const prefix = match.startsWith("*") ? "" : match[0];
        const suffix = match.endsWith("*") ? "" : match[match.length - 1];
        return `${prefix}**${inner1.trim()}**${suffix}`;
      }
      if (inner2) {
        const prefix = match.startsWith("*") ? "" : match[0];
        const suffix = match.endsWith("*") ? "" : match[match.length - 1];
        return `${prefix}**${inner2.trim()}**${suffix}`;
      }
      return match;
    }
  );

  return normalized.replace(
    /(```[\s\S]*?```|`[^`\n]*`)|(\*\*([^\*\r\n]+?)\*\*(\s*))|(__([^_\r\n]+?)__(\s*))/g,
    (match, code, _boldAsterisk, innerAsterisk, trailingSpaceAsterisk, _boldUnderscore, innerUnderscore, trailingSpaceUnderscore) => {
      if (code) return code;
      if (innerAsterisk) {
        const trimmed = innerAsterisk.trim();
        if (!trimmed) return match;
        const hadTrailingSpaceInside = /\s+$/.test(innerAsterisk);
        const endsWithPunct = /[)\].!?,:;'"’”`~\-_\\]$/.test(trimmed);
        const shouldAddSpaceAfter = hadTrailingSpaceInside || (endsWithPunct && !trailingSpaceAsterisk);
        return `**${trimmed}**${shouldAddSpaceAfter && !trailingSpaceAsterisk ? " " : trailingSpaceAsterisk}`;
      }
      if (innerUnderscore) {
        const trimmed = innerUnderscore.trim();
        if (!trimmed) return match;
        const hadTrailingSpaceInside = /\s+$/.test(innerUnderscore);
        const endsWithPunct = /[)\].!?,:;'"’”`~\-_\\]$/.test(trimmed);
        const shouldAddSpaceAfter = hadTrailingSpaceInside || (endsWithPunct && !trailingSpaceUnderscore);
        return `__${trimmed}__${shouldAddSpaceAfter && !trailingSpaceUnderscore ? " " : trailingSpaceUnderscore}`;
      }
      return match;
    }
  );
}

/**
 * 规范化块级数学公式定界符（$$...$$）：
 * remark-math 要求 display math 的 $$ 必须独占一行，
 * 否则当模型输出 `$$\begin{aligned}` 或 `\end{aligned}$$ 后续正文` 时：
 * 1) 开头的 `\begin{aligned}` 会被 remark-math 误认作代码块语言 meta 从而被剥离；
 * 2) 结尾的 `$$` 无法匹配闭合围栏，导致后续整段中文与粗体被直接吞入公式块，引发 KaTeX 语法报错并在页面标红；
 * 本函数在保护代码块的前提下，将成对的 $$ 及其内部公式体规范格式化为带独占空行与换行的标准块，
 * 并将闭合 $$ 之后的正文平滑还给常规 Markdown 流。
 */
export function normalizeDisplayMath(text: string): string {
  if (!text || !text.includes("$$")) return text;
  // 1. 处理完整闭合的 $$...$$ 块（消除行内紧贴与后置正文吞入问题）
  let result = text.replace(
    /(```[\s\S]*?```|`[^`\n]*`)|(\$\$([\s\S]+?)\$\$)/g,
    (match, code, _math, mathBody) => {
      if (code) return code;
      if (mathBody) {
        const trimmed = mathBody.trim();
        if (!trimmed) return "";
        return `\n\n$$\n${trimmed}\n$$\n\n`;
      }
      return match;
    }
  );

  // 2. 处理流式输出过程中尚未闭合的起始 $$（如 `$$\begin{aligned}`），确保内容换行防止被解析为 meta
  result = result.replace(
    /(```[\s\S]*?```|`[^`\n]*`)|(^|\n)([ \t]*)\$\$([^\n$]+)$/g,
    (match, code, pre, indent, content) => {
      if (code) return code;
      return `${pre}${indent}$$\n${indent}${content}`;
    }
  );

  return result;
}

/**
 * 稳定流式输出期间尚未闭合的 Markdown 表格行：
 * GFM 表格在流式打字期间如果最后一行只有 `| col1 | col2` 缺少收尾 `|`，
 * 可能会导致 GFM 临时回退为段落 `<p>` 引发高度剧烈抖动；在行尾安全补上 ` |`，防止抖动。
 */
export function stabilizeStreamingTable(text: string): string {
  if (!text || !text.includes("|")) return text;
  const lines = text.split("\n");
  const lastLine = lines[lines.length - 1];
  if (lastLine && /^\s*\|.*[^|\s]\s*$/.test(lastLine)) {
    const hasTableContext = lines.some((l) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(l));
    if (hasTableContext) {
      lines[lines.length - 1] = `${lastLine} |`;
      return lines.join("\n");
    }
  }
  return text;
}

/**
 * 综合预处理：闭合流式截断的代码块围栏 + 稳定表格流式行 + 规范化数学公式定界符 + 规范化松散 Markdown 强调标记。
 */
export function preprocessMarkdown(text: string): string {
  return normalizeLooseEmphasis(normalizeDisplayMath(stabilizeStreamingTable(closeOpenFences(text))));
}
