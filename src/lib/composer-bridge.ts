/**
 * 编辑器与 Agent Composer 通信桥接：
 * - 选中文本快速发送到对话（带文件路径、行号范围与代码块）；
 * - 工作区文件 / 目录全局拖拽到对话区，自动转换为 @ 引用与附件。
 */
import type { DragRef } from "./composer-drop";

export interface CodeSnippetPayload {
  path: string;
  fromLine?: number;
  toLine?: number;
  code: string;
  lang?: string;
  cwd?: string | null;
}

export const ACP_INSERT_SNIPPET_EVENT = "acp:insert-snippet";
export const ACP_COMPOSER_DROP_EVENT = "acp:composer-drop";

/**
 * 将代码片段规范化为 LLM 易于理解的 Markdown 结构（带文件路径、行号与语言围栏）
 */
export function formatSnippetPrompt(payload: CodeSnippetPayload): string {
  const lineSuffix =
    payload.fromLine != null
      ? `#L${payload.fromLine}${payload.toLine != null && payload.toLine > payload.fromLine ? `-L${payload.toLine}` : ""}`
      : "";
  const lang = payload.lang || "";
  const code = payload.code.trimEnd();
  return `@${payload.path}${lineSuffix}\n\`\`\`${lang}\n${code}\n\`\`\``;
}

/**
 * 触发向 Agent 对话框发送代码片段
 */
export function sendSnippetToComposer(payload: CodeSnippetPayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CodeSnippetPayload>(ACP_INSERT_SNIPPET_EVENT, { detail: payload })
  );
}

export interface ComposerDropPayload {
  internalRefs?: DragRef[];
  files?: File[];
  text?: string;
}

/**
 * 触发向 Agent 对话框转发拖拽文件与目录
 */
export function sendDropToComposer(payload: ComposerDropPayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ComposerDropPayload>(ACP_COMPOSER_DROP_EVENT, { detail: payload })
  );
}

