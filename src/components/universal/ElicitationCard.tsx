import React, { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BlurFade } from "@/components/magicui/blur-fade";
import type { PendingElicitation } from "@/lib/universal-api";

export interface ElicitationCardProps {
  e: PendingElicitation;
  onRespond: (e: PendingElicitation, accept: boolean, payload?: unknown) => void;
  busy: boolean;
}

interface FieldDef {
  key: string;
  title: string;
  description?: string;
  type: string;
  enum?: string[];
  required: boolean;
}

/** Extract JSON-schema form fields from elicitation params (requestedSchema). */
function extractFields(schema: any): { mode: string; url?: string; fields: FieldDef[]; title?: string; description?: string } {
  const s = schema || {};
  if (s.mode === "url" && s.url) {
    return { mode: "url", url: s.url, fields: [] };
  }
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
  return { mode: "form", fields, title: rs.title || s.message, description: rs.description };
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

export const ElicitationCard: React.FC<ElicitationCardProps> = ({ e, onRespond, busy }) => {
  const { mode, url, fields, title, description } = extractFields(e.schema);
  const [values, setValues] = useState<Record<string, string>>({});
  const [rawJson, setRawJson] = useState("");
  const [useRaw, setUseRaw] = useState(false);

  const submit = () => {
    if (useRaw || fields.length === 0) {
      let payload: unknown = {};
      if ((useRaw ? rawJson : "") && rawJson.trim()) {
        try {
          payload = JSON.parse(rawJson);
        } catch {
          alert("不是合法 JSON");
          return;
        }
      }
      onRespond(e, true, payload);
      return;
    }
    const content: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.key] ?? "";
      if (!raw && !f.required) continue;
      if (!raw && f.required) {
        alert(`请填写必填项：${f.title}`);
        return;
      }
      content[f.key] = coerce(f.type, raw);
    }
    onRespond(e, true, content);
  };

  return (
    <BlurFade>
    <div className="rounded-xl border border-primary/40 bg-primary/30 p-3 text-xs space-y-2">
      <div className="font-semibold text-primary">{title || e.message}</div>
      {description && <div className="text-primary/70">{description}</div>}

      {mode === "url" && url && (
        <Button size="sm" variant="outline" onClick={() => window.open(url, "_blank")} className="gap-1.5 h-7 text-[11px]">
          <ExternalLink className="w-3 h-3" /> 在浏览器中打开
        </Button>
      )}

      {mode === "form" && fields.length > 0 && !useRaw && (
        <div className="space-y-2">
          {fields.map((f) => (
            <label key={f.key} className="block space-y-1">
              <span className="text-muted-foreground">
                {f.title} {f.required && <span className="text-destructive">*</span>}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">{f.type}</span>
              </span>
              {f.enum ? (
                <select
                  value={values[f.key] ?? ""}
                  onChange={(ev) => setValues((prev) => ({ ...prev, [f.key]: ev.target.value }))}
                  className="w-full rounded-lg bg-background border border-border px-2 py-1.5 outline-none"
                >
                  <option value="">请选择…</option>
                  {f.enum.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : f.type === "boolean" ? (
                <select
                  value={values[f.key] ?? ""}
                  onChange={(ev) => setValues((prev) => ({ ...prev, [f.key]: ev.target.value }))}
                  className="w-full rounded-lg bg-background border border-border px-2 py-1.5 outline-none"
                >
                  <option value="">请选择…</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  value={values[f.key] ?? ""}
                  onChange={(ev) => setValues((prev) => ({ ...prev, [f.key]: ev.target.value }))}
                  placeholder={f.description || ""}
                  className="w-full rounded-lg bg-background border border-border px-2 py-1.5 outline-none"
                />
              )}
              {f.description && <div className="text-[11px] text-muted-foreground">{f.description}</div>}
            </label>
          ))}
        </div>
      )}

      {(useRaw || fields.length === 0) && mode === "form" && (
        <textarea
          value={rawJson}
          onChange={(ev) => setRawJson(ev.target.value)}
          placeholder='accept 时提交的 JSON content（可空 {}）'
          rows={2}
          spellCheck={false}
          className="w-full rounded-lg bg-background border border-border px-2 py-1.5 font-mono text-[11px] outline-none"
        />
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="default" disabled={busy} onClick={submit} className="h-7 text-[11px]">
          {busy ? "提交中…" : "提交"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onRespond(e, false)} className="h-7 text-[11px]">
          拒绝
        </Button>
        <div className="flex-1" />
        {fields.length > 0 && (
          <button onClick={() => setUseRaw((v) => !v)} className="text-[11px] font-mono text-muted-foreground hover:text-muted-foreground">
            {useRaw ? "表单模式" : "原始 JSON"}
          </button>
        )}
      </div>

      <details className="text-muted-foreground">
        <summary className="cursor-pointer text-[11px]">schema 详情</summary>
        <pre className="font-mono text-[10px] whitespace-pre-wrap max-h-32 overflow-y-auto">{JSON.stringify(e.schema, null, 2).slice(0, 2000)}</pre>
      </details>
    </div>
    </BlurFade>
  );
};
