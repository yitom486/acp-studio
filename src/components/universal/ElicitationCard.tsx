import React, { useMemo, useState } from "react";
import { ExternalLink, Code2 } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import ApprovalCard, { type ApprovalQuestion } from "@/components/primitives/ApprovalCard";
import type { PendingElicitation } from "@/lib/universal-api";

export interface ElicitationCardProps {
  e: PendingElicitation;
  onRespond: (e: PendingElicitation, accept: boolean, payload?: unknown) => void;
  busy: boolean;
  className?: string;
}

interface FieldDef {
  key: string;
  title: string;
  description?: string;
  type: string;
  enum?: string[];
  required: boolean;
}

function coerce(type: string, v: string): unknown {
  if (type === "boolean") return v === "true" || v === "on" || v === "1";
  if (type === "integer") {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? v : n;
  }
  if (type === "number") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? v : n;
  }
  return v;
}

export const ElicitationCard: React.FC<ElicitationCardProps> = ({ e, onRespond, busy, className }) => {
  const [showRaw, setShowRaw] = useState(false);
  const [rawJson, setRawJson] = useState("");

  const parsed = useMemo(() => {
    const s = e.schema || {};
    if (s.mode === "url" && s.url) {
      return { mode: "url" as const, url: s.url as string, title: e.message || "需要前往浏览器确认" };
    }

    // 1. OpenCode format: schema.questions = [{ question, header, options, multiple }]
    if (Array.isArray(s.questions) && s.questions.length > 0) {
      const questions: ApprovalQuestion[] = s.questions.map((q: any) => ({
        q: q.question || q.header || e.message || "请选择或确认：",
        type: q.multiple ? "check" : "radio",
        options: (q.options || []).map((o: any) => (typeof o === "string" ? o : o.label || o.title || o.name || String(o))),
      }));
      return { mode: "opencode" as const, questions, rawQuestions: s.questions };
    }

    // 2. Standard JSON-Schema form fields
    const rs = s.requestedSchema || s.schema || {};
    const props = rs.properties || {};
    const required: string[] = rs.required || [];
    const fields: FieldDef[] = Object.entries(props).map(([key, def]: [string, any]) => {
      const t = Array.isArray(def?.type) ? def.type.find((x: string) => x !== "null") || "string" : def?.type || "string";
      return {
        key,
        title: def?.title || key,
        description: def?.description,
        type: t,
        enum: def?.enum,
        required: required.includes(key),
      };
    });

    if (fields.length > 0) {
      const questions: ApprovalQuestion[] = fields.map((f) => {
        let opts = f.enum;
        if (!opts || opts.length === 0) {
          if (f.type === "boolean") opts = ["是 (true)", "否 (false)"];
          else opts = [];
        }
        return {
          q: f.title ? `${f.title}${f.description ? ` (${f.description})` : ""}` : f.key,
          type: f.type === "array" ? "check" : "radio",
          options: opts,
        };
      });
      return { mode: "schema" as const, questions, fields, title: rs.title || e.message };
    }

    // 3. Fallback: general question or confirmation
    const fallbackQuestion: ApprovalQuestion = {
      q: e.message || "智能体需要您的确认与输入：",
      type: "radio",
      options: ["确认继续 (Continue)", "取消 / 拒绝 (Decline)"],
    };
    return { mode: "fallback" as const, questions: [fallbackQuestion] };
  }, [e]);

  if (parsed.mode === "url") {
    return (
      <div className={`rounded-card bg-surface shadow-card border border-line p-3.5 space-y-2.5 ${className || ""}`}>
        <div className="font-semibold text-[13.5px] text-ink leading-snug">{parsed.title}</div>
        <div className="text-[12px] text-ink-2 break-all">{parsed.url}</div>
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => window.open(parsed.url, "_blank")}
            className="gap-1.5 h-8 text-[12px]"
          >
            <ExternalLink className="w-3.5 h-3.5" /> 在浏览器中打开
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onRespond(e, false)}
            className="h-8 text-[12px] text-ink-3 hover:text-ink"
          >
            跳过
          </Button>
        </div>
      </div>
    );
  }

  const handleSubmitted = (answers: Record<number, number[]>, customAnswers: Record<number, string>) => {
    if (showRaw) {
      let payload: unknown = {};
      if (rawJson.trim()) {
        try {
          payload = JSON.parse(rawJson);
        } catch {
          alert("不是合法的 JSON 格式");
          return;
        }
      }
      onRespond(e, true, payload);
      return;
    }

    if (parsed.mode === "opencode") {
      const resultAnswers: any[] = [];
      const contentAnswers: Record<string, any> = {};
      parsed.questions.forEach((q, idx) => {
        const custom = customAnswers[idx]?.trim();
        const selectedIndices = answers[idx] ?? [];
        let val: any = null;
        if (custom) {
          val = custom;
        } else if (q.type === "radio") {
          val = selectedIndices.length > 0 ? q.options[selectedIndices[0]] : "";
        } else {
          val = selectedIndices.map((i) => q.options[i]);
        }
        resultAnswers.push(val);
        const rawQ = parsed.rawQuestions?.[idx];
        const key = rawQ?.header || rawQ?.question || `q${idx}`;
        contentAnswers[key] = val;
      });

      onRespond(e, true, { answers: resultAnswers, ...contentAnswers });
      return;
    }

    if (parsed.mode === "schema" && parsed.fields) {
      const content: Record<string, unknown> = {};
      parsed.fields.forEach((f, idx) => {
        const custom = customAnswers[idx]?.trim();
        const selectedIndices = answers[idx] ?? [];
        const q = parsed.questions[idx];
        let rawVal = "";
        if (custom) {
          rawVal = custom;
        } else if (q.type === "radio" && selectedIndices.length > 0) {
          rawVal = q.options[selectedIndices[0]] ?? "";
          if (f.type === "boolean") {
            rawVal = rawVal.includes("true") ? "true" : "false";
          }
        } else if (q.type === "check") {
          content[f.key] = selectedIndices.map((i) => q.options[i]);
          return;
        }
        if (rawVal) {
          content[f.key] = coerce(f.type, rawVal);
        }
      });
      onRespond(e, true, content);
      return;
    }

    // Fallback mode
    const custom = customAnswers[0]?.trim();
    const selectedIdx = answers[0]?.[0] ?? 0;
    const isConfirm = selectedIdx === 0 && !custom;
    onRespond(e, true, { accepted: isConfirm, answer: custom || parsed.questions[0].options[selectedIdx] });
  };

  return (
    <div className={`space-y-1.5 ${className || ""}`}>
      {showRaw ? (
        <div className="rounded-card bg-surface shadow-card border border-line p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[13px] text-ink">{e.message || "原始 Elicitation 交互"}</span>
            <button
              type="button"
              onClick={() => setShowRaw(false)}
              className="text-[11px] text-primary hover:underline"
            >
              返回问答卡片
            </button>
          </div>
          <textarea
            value={rawJson}
            onChange={(ev) => setRawJson(ev.target.value)}
            placeholder="accept 时提交的 JSON content（如 {}）"
            rows={3}
            spellCheck={false}
            className="w-full rounded-control bg-inset/40 border border-line px-2.5 py-1.5 font-mono text-[11px] text-ink outline-none"
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => onRespond(e, false)}>
              跳过
            </Button>
            <Button size="xs" variant="primary" disabled={busy} onClick={() => handleSubmitted({}, {})}>
              提交 JSON
            </Button>
          </div>
        </div>
      ) : (
        <ApprovalCard
          questions={parsed.questions}
          labels={{
            skip: "跳过",
            continue: "继续",
            send: busy ? "提交中…" : "确认提交",
            customPlaceholder: "自定义补充或输入…",
            sentMessage: "已提交回答",
          }}
          onSubmitted={handleSubmitted}
          onDismiss={() => onRespond(e, false)}
          className="w-full max-w-full"
        />
      )}

      {/* 底部微型调试开关 */}
      <div className="flex items-center justify-end pr-1">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="inline-flex items-center gap-1 text-[10px] font-mono text-ink-3 hover:text-ink transition-colors cursor-pointer"
        >
          <Code2 className="w-2.5 h-2.5" />
          <span>{showRaw ? "卡片视图" : "原始 Schema"}</span>
        </button>
      </div>
    </div>
  );
};
