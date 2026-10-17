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
  return text.replace(
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
 * 综合预处理：闭合流式截断的代码块围栏 + 规范化松散 Markdown 强调标记。
 */
export function preprocessMarkdown(text: string): string {
  return normalizeLooseEmphasis(closeOpenFences(text));
}
