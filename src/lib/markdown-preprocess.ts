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
