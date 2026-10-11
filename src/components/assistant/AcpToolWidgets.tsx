import React from "react";
import {
  Check,
  Copy,
  FileDiff,
  FileText,
  PencilLine,
  Search,
  ShieldAlert,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStudioStore } from "@/stores/useStudioStore";
import { matchPermToToolCalls } from "@/lib/acp-assistant";
import { respondPermission, type PendingPermission } from "@/lib/universal-api";

/**
 * Generative UI（展示型）：同一份 ACP 工具调用数据，按工具种类渲染专属卡片，
 * 未知种类回落通用行。只画 arriving 数据，不编造；纯前端，无需后端改动。
 */

export interface WidgetTool {
  id: string;
  title: string;
  kind?: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt?: number;
  completedAt?: number;
  name?: string;
  rawInput?: unknown;
  locations?: Array<{ path: string; line?: number }>;
  rawOutput?: unknown;
  rawError?: unknown;
}

export type WidgetKey = "terminal" | "file-read" | "file-edit" | "search";

// ---------- pure data helpers (unit-tested) ----------

/** Human-readable text out of unknown tool payloads, capped. */
export function toolText(v: unknown, cap = 4000): string {
  let s = "";
  if (typeof v === "string") s = v;
  else if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") s = String(v);
  else if (v == null) return "";
  else {
    try {
      s = JSON.stringify(v, null, 1);
    } catch {
      return "";
    }
  }
  return s.length > cap ? s.slice(0, cap) + "\n…[truncated]" : s;
}

export function firstLines(text: string, n: number): { shown: string; total: number } {
  const all = text.split("\n");
  return { shown: all.slice(0, n).join("\n"), total: all.length };
}

export function lastLines(text: string, n: number): { shown: string; total: number } {
  const all = text.split("\n");
  return { shown: all.slice(-n).join("\n"), total: all.length };
}

export function extractFileFromTool(title: string): string | null {
  if (!title) return null;
  const match = title.match(/([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]{1,10})/);
  if (match) {
    const candidate = match[1];
    if (
      candidate.includes("/") ||
      candidate.includes("\\") ||
      /\.(tsx?|jsx?|json|md|css|html|rs|py|go|cs)$/i.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

export function strField(obj: unknown, keys: string[]): string | null {  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/** Best-effort file path: locations -> params -> title. */
export function toolPath(tc: Pick<WidgetTool, "title" | "locations" | "rawInput">): string | null {
  const loc = tc.locations?.find((l) => l && typeof l.path === "string" && l.path);
  if (loc) return loc.path;
  const fromParams = strField(tc.rawInput, ["path", "file", "filePath", "filename", "pattern", "dir", "directory"]);
  if (fromParams) return fromParams;
  return extractFileFromTool(tc.title);
}

/** Best-effort command line: params -> title. */
export function toolCommand(tc: Pick<WidgetTool, "title" | "rawInput">): string {
  const cmd = strField(tc.rawInput, ["CommandLine", "command", "cmd", "script", "code"]);
  if (cmd) {
    const oneLine = cmd.trim().replace(/\s+/g, " ");
    return oneLine.length > 200 ? oneLine.slice(0, 199) + "…" : oneLine;
  }
  return tc.title;
}

/** Heuristic: at least 2 +/- content lines => looks like a diff. */
export function isDiffText(t: string): boolean {
  let hits = 0;
  for (const line of t.split("\n")) {
    if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) {
      if (++hits >= 2) return true;
    }
  }
  return false;
}

/** kind -> name -> title, conservative; unknown => null (generic row). */
export function resolveWidgetKey(tc: Pick<WidgetTool, "title" | "kind" | "name">): WidgetKey | null {
  const kind = (tc.kind || "").toLowerCase();
  if (kind === "execute" || kind === "terminal") return "terminal";
  if (kind === "edit" || kind === "diff") return "file-edit";
  if (kind === "read" || kind === "file") return "file-read";
  if (kind === "search") return "search";

  const name = (tc.name || "").toLowerCase();
  if (/^(run_|exec|terminal|shell|bash|sh_|powershell)/.test(name) || name.includes("command")) return "terminal";
  if (/^(write_|replace_|multi_|sed|edit|apply_)/.test(name)) return "file-edit";
  if (/^(read_|view_|cat|list_)/.test(name)) return "file-read";
  if (/^(find_|grep|search)/.test(name) || /search|grep/.test(name)) return "search";

  const title = tc.title || "";
  if (/^(run|exec|npm|bun|yarn|node|python|git|docker|ls|cd|mkdir|rm|echo|chmod|cargo|go|cat)\s/i.test(title)) {
    return /^(cat|ls)\s/i.test(title) ? "file-read" : "terminal";
  }
  if (/^(read|view|show|list)\s/i.test(title)) return "file-read";
  return null;
}

/** 真实耗时格式化（客户端 wall-clock 打点，无数据时不渲染）。 */
export function fmtElapsed(ms: number): string {
  if (ms < 0) return "";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}分${String(s).padStart(2, "0")}s`;
}

/**
 * 真实耗时：完成后静态，运行中每 500ms 跳一次。
 * 数据来自 App 发送路径的客户端打点（首见/终态时间戳）。
 */
export const LiveElapsed: React.FC<{ startedAt?: number; completedAt?: number }> = ({
  startedAt,
  completedAt,
}) => {
  const [, setTick] = React.useState(0);
  const live = startedAt != null && completedAt == null;
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [live, startedAt]);
  if (startedAt == null) return null;
  const ms = (completedAt ?? Date.now()) - startedAt;
  return <span className="font-mono text-[10px] text-muted-foreground/80 tabular-nums">{fmtElapsed(ms)}</span>;
};

// ---------- shared bits ----------

export function StatusDot({ status }: { status: WidgetTool["status"] }) {
  const active = status === "running" || status === "pending";
  return (
    <span
      className={cn(
        "w-2 h-2 rounded-full shrink-0",
        active
          ? "bg-warning animate-pulse"
          : status === "completed"
            ? "bg-success"
            : status === "cancelled"
              ? "bg-muted-foreground"
              : "bg-destructive",
      )}
    />
  );
}

export const CopyTextBtn: React.FC<{ text: string; title?: string }> = ({ text, title }) => {
  const [copied, setCopied] = React.useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center gap-1 hover:text-foreground transition-colors shrink-0"
      title={title || "复制"}
    >
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
      {copied ? "已复制" : "复制"}
    </button>
  );
};

/** Match this tool to a pending ACP permission (same rule as the App dialog filter). */
export function useInlinePerm(tc: Pick<WidgetTool, "id" | "title">): {
  perm: PendingPermission | null;
  busy: boolean;
  respond: (optionId: string | null) => Promise<void>;
} {
  const sessionId = useStudioStore((s) => s.sessionId);
  const respondingId = useStudioStore((s) => s.respondingId);
  const pendingPerms = useStudioStore((s) => s.pendingPerms);
  const perm = React.useMemo(() => {
    const st = useStudioStore.getState();
    for (const p of pendingPerms) {
      if (sessionId && p.sessionId !== sessionId) continue;
      const tool = (p.toolCall ?? {}) as { toolCallId?: string; id?: string; title?: string };
      const wantId = tool.toolCallId || tool.id || null;
      const wantTitle = tool.title || null;
      if ((wantId && tc.id === wantId) || (wantTitle && tc.title === wantTitle)) {
        if (matchPermToToolCalls(p, st.messages, sessionId)) return p;
      }
    }
    return null;
  }, [pendingPerms, sessionId, tc.id, tc.title]);
  const busy = perm != null && respondingId === perm.permissionId;
  const respond = React.useCallback(
    async (optionId: string | null) => {
      if (!perm) return;
      const st = useStudioStore.getState();
      st.setRespondingId(perm.permissionId);
      try {
        await respondPermission(
          perm.agentId,
          perm.permissionId,
          optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
        );
        useStudioStore.getState().removePermission(perm.permissionId);
      } catch (e: any) {
        alert(`permission respond 失败: ${e.message}`);
      } finally {
        useStudioStore.getState().setRespondingId(null);
      }
    },
    [perm]
  );
  return { perm, busy, respond };
}

export const InlineApproval: React.FC<{ tc: Pick<WidgetTool, "id" | "title"> }> = ({ tc }) => {
  const { perm, busy, respond } = useInlinePerm(tc);
  if (!perm) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2 pt-0.5 border-t border-warning/30 font-sans">
      <span className="flex items-center gap-1 text-warning font-semibold text-[11px]">
        <ShieldAlert className="w-3.5 h-3.5" />
        需要授权
      </span>
      {(perm.options || []).slice(0, 3).map((o) => (
        <button
          key={o.optionId}
          type="button"
          disabled={busy}
          onClick={() => respond(o.optionId)}
          className="px-2 py-0.5 rounded-md border border-warning/40 text-warning text-[11px] font-medium hover:bg-warning hover:text-warning-foreground transition-colors disabled:opacity-40"
          title={o.kind || o.optionId}
        >
          {busy ? "提交中..." : o.name}
        </button>
      ))}
      <button
        type="button"
        disabled={busy}
        onClick={() => respond(null)}
        className="px-2 py-0.5 rounded-md text-muted-foreground text-[11px] hover:text-destructive transition-colors disabled:opacity-40"
        title="拒绝 / 取消"
      >
        拒绝
      </button>
    </div>
  );
};

export const DiffButton: React.FC<{ file: string | null }> = ({ file }) => {
  const onOpenDiff = useStudioStore((s) => s.setGitChangesOpen);
  if (!file) return null;
  return (
    <button
      type="button"
      onClick={() => onOpenDiff(true, file)}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-sans transition-colors shrink-0"
      title={`在 Git 审查中查看 ${file}`}
    >
      <FileDiff className="w-3 h-3" />
      <span>Diff</span>
    </button>
  );
};

function CardShell({
  icon,
  title,
  right,
  dot,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
  dot: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-background/80 border border-border text-xs text-muted-foreground animate-fade-slide-in overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {icon}
        <span className="flex-1 truncate font-mono" title={title}>
          {title}
        </span>
        {right}
        {dot}
      </div>
      {children}
    </div>
  );
}

// ---------- widgets ----------

function CodePreview({ text, maxLines = 12 }: { text: string; maxLines?: number }) {
  if (!text) return null;
  const { shown, total } = firstLines(text, maxLines);
  return (
    <div className="mx-1.5 mb-1.5 rounded-md border border-border/60 bg-background/60 overflow-hidden">
      <pre className="px-2.5 py-2 overflow-x-auto text-[11px] leading-relaxed font-mono text-foreground/90 whitespace-pre">
        <code>{shown}</code>
      </pre>
      <div className="flex items-center justify-between px-2.5 py-1 border-t border-border/60 font-mono text-[10px] text-muted-foreground/80">
        <span className="tabular-nums">{total} 行{total > maxLines ? `（前 ${maxLines} 行）` : ""}</span>
        <CopyTextBtn text={text} title="复制全部内容" />
      </div>
    </div>
  );
}

function DiffPreview({ text, maxLines = 24 }: { text: string; maxLines?: number }) {
  const all = text.split("\n");
  const shown = all.slice(0, maxLines);
  return (
    <div className="mx-1.5 mb-1.5 rounded-md border border-border/60 bg-background/60 overflow-hidden">
      <pre className="px-2 py-2 overflow-x-auto text-[11px] leading-relaxed font-mono whitespace-pre">
        <code>
          {shown.map((line, i) => (
            <div
              key={i}
              className={cn(
                "px-1.5 rounded",
                line.startsWith("+") && !line.startsWith("+++") && "bg-success/15 text-foreground",
                line.startsWith("-") && !line.startsWith("---") && "bg-destructive/15 text-foreground",
                line.startsWith("@@") && "text-primary",
              )}
            >
              {line || " "}
            </div>
          ))}
        </code>
      </pre>
      {all.length > maxLines && (
        <div className="px-2.5 py-1 border-t border-border/60 font-mono text-[10px] text-muted-foreground/80 tabular-nums">
          …还有 {all.length - maxLines} 行
        </div>
      )}
    </div>
  );
}

export const FileReadCard: React.FC<{ tc: WidgetTool }> = ({ tc }) => {
  const path = toolPath(tc);
  const output = toolText(tc.rawOutput);
  return (
    <CardShell
      icon={<FileText className="w-3.5 h-3.5 text-primary shrink-0" />}
      title={path || tc.title}
      right={
        <>
          <LiveElapsed startedAt={tc.startedAt} completedAt={tc.completedAt} />
          <DiffButton file={path} />
        </>
      }
      dot={<StatusDot status={tc.status} />}
    >
      {output ? (
        <CodePreview text={output} />
      ) : tc.status === "running" || tc.status === "pending" ? (
        <div className="mx-1.5 mb-1.5 px-2.5 py-2 font-mono text-[11px] text-muted-foreground animate-pulse">
          正在读取…
        </div>
      ) : null}
      <InlineApproval tc={tc} />
    </CardShell>
  );
};

export const FileEditCard: React.FC<{ tc: WidgetTool }> = ({ tc }) => {
  const path = toolPath(tc);
  const output = toolText(tc.rawOutput);
  const err = toolText(tc.rawError);
  return (
    <CardShell
      icon={<PencilLine className="w-3.5 h-3.5 text-warning shrink-0" />}
      title={path || tc.title}
      right={
        <>
          <LiveElapsed startedAt={tc.startedAt} completedAt={tc.completedAt} />
          <DiffButton file={path} />
        </>
      }
      dot={<StatusDot status={tc.status} />}
    >
      {output ? (
        isDiffText(output) ? (
          <DiffPreview text={output} />
        ) : (
          <CodePreview text={output} />
        )
      ) : err ? (
        <div className="mx-1.5 mb-1.5 px-2.5 py-2 rounded-md border border-destructive/40 bg-destructive/10 font-mono text-[11px] text-destructive break-words">
          {firstLines(err, 8).shown}
        </div>
      ) : tc.status === "running" || tc.status === "pending" ? (
        <div className="mx-1.5 mb-1.5 px-2.5 py-2 font-mono text-[11px] text-muted-foreground animate-pulse">
          正在写入…
        </div>
      ) : null}
      <InlineApproval tc={tc} />
    </CardShell>
  );
};

export const TerminalCard: React.FC<{ tc: WidgetTool }> = ({ tc }) => {
  const cmd = toolCommand(tc);
  const output = toolText(tc.rawOutput);
  const err = toolText(tc.rawError);
  const failed = tc.status === "failed";
  return (
    <CardShell
      icon={<SquareTerminal className="w-3.5 h-3.5 text-primary shrink-0" />}
      title={cmd}
      right={<LiveElapsed startedAt={tc.startedAt} completedAt={tc.completedAt} />}
      dot={<StatusDot status={tc.status} />}
    >
      {output || err || tc.status === "running" || tc.status === "pending" ? (
        <div className="mx-1.5 mb-1.5 rounded-md border border-border/60 bg-black/40 overflow-hidden">
          {output && (
            <pre className="px-2.5 py-2 overflow-x-auto text-[11px] leading-relaxed font-mono text-foreground/90 whitespace-pre-wrap break-words">
              <code>{lastLines(output, 12).shown}</code>
            </pre>
          )}
          {err && (
            <pre className="px-2.5 py-2 overflow-x-auto text-[11px] leading-relaxed font-mono text-destructive whitespace-pre-wrap break-words border-t border-destructive/30">
              <code>{lastLines(err, 8).shown}</code>
            </pre>
          )}
          {!output && !err && (
            <div className="px-2.5 py-2 font-mono text-[11px] text-muted-foreground animate-pulse">
              执行中…
            </div>
          )}
          {failed && !err && (
            <div className="px-2.5 py-1 border-t border-destructive/30 font-mono text-[10px] text-destructive">
              执行失败
            </div>
          )}
        </div>
      ) : null}
      <InlineApproval tc={tc} />
    </CardShell>
  );
};

export const SearchCard: React.FC<{ tc: WidgetTool }> = ({ tc }) => {
  const query = strField(tc.rawInput, ["pattern", "query", "text", "keyword"]) || tc.title;
  const output = toolText(tc.rawOutput);
  const matchLines = output ? output.split("\n").filter((l) => l.trim()).length : 0;
  return (
    <CardShell
      icon={<Search className="w-3.5 h-3.5 text-primary shrink-0" />}
      title={query.length > 120 ? query.slice(0, 119) + "…" : query}
      right={
        <>
          {matchLines > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground/80 tabular-nums">
              {matchLines} 命中
            </span>
          )}
          <LiveElapsed startedAt={tc.startedAt} completedAt={tc.completedAt} />
        </>
      }
      dot={<StatusDot status={tc.status} />}
    >
      {output ? (
        <CodePreview text={output} maxLines={8} />
      ) : tc.status === "running" || tc.status === "pending" ? (
        <div className="mx-1.5 mb-1.5 px-2.5 py-2 font-mono text-[11px] text-muted-foreground animate-pulse">
          搜索中…
        </div>
      ) : null}
      <InlineApproval tc={tc} />
    </CardShell>
  );
};

export function WidgetFallbackIcon() {
  return <Wrench className="w-3.5 h-3.5 text-primary shrink-0" />;
}
