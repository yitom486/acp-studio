import type { Attachment, WorkspaceFileContent } from "./universal-api";

/**
 * @-mention helpers (pure, unit-tested). Mirrors the slash-command UX:
 * trailing-token detection, Tab/click to complete, Enter always sends.
 */

/** Trailing `@query` token (path chars + unicode, no spaces). */
export function matchMentionToken(text: string): string | null {
  const m = text.match(/(^|\s)@([^\s@]*)$/);
  return m ? `@${m[2]}` : null;
}

/** Replace the trailing @-token with the picked display name + space. */
export function applyMentionInsert(text: string, displayName: string): string {
  return text.replace(/(^|\s)(@[^\s@]*)$/, `$1@${displayName} `);
}

/** Workspace file content -> composer attachment (resource block, texts only). */
export function buildMentionAttachment(f: WorkspaceFileContent): Attachment {
  const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: f.file,
    mimeType: f.mimeType || "text/plain",
    size: f.size,
    block: {
      type: "resource",
      resource: {
        uri: `file:///${f.file}`,
        mimeType: f.mimeType || "text/plain",
        text: f.text + (f.truncated ? "\n…[truncated at 64KB]" : ""),
      },
    },
  };
}

/** Human size for the mention picker rows. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
