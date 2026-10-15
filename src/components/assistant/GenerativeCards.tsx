import React, { useState } from "react";
import {
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Circle,
  HelpCircle,
  ListTodo,
  Send,
  Sliders,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface InteractiveCardData {
  title: string;
  cardType?: "decision" | "metrics" | "checklist" | "form";
  description?: string;
  data?: Record<string, any>;
  onSubmit?: (val: any) => void;
}

/**
 * 方案决策卡片：多方案/选择支点击决策
 */
export const DecisionCard: React.FC<{
  title: string;
  description?: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    badge?: string;
    recommended?: boolean;
  }>;
  onSelect?: (id: string) => void;
}> = ({ title, description, options = [], onSelect }) => {
  const [selected, setSelected] = useState<string | null>(() => {
    const rec = options.find((o) => o.recommended);
    return rec ? rec.id : null;
  });

  const handlePick = (id: string) => {
    setSelected(id);
    onSelect?.(id);
  };

  return (
    <div className="rounded-xl border border-border bg-card/90 p-4 shadow-sm my-2.5 max-w-xl text-card-foreground">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-5 h-5 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <HelpCircle className="w-3.5 h-3.5" />
        </div>
        <h4 className="font-semibold text-sm text-foreground">{title}</h4>
      </div>
      {description && (
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {description}
        </p>
      )}

      <div className="space-y-2 mt-2">
        {options.map((opt) => {
          const isSelected = selected === opt.id;
          return (
            <div
              key={opt.id}
              onClick={() => handlePick(opt.id)}
              className={cn(
                "group relative flex items-start justify-between p-3 rounded-lg border transition-all cursor-pointer select-none",
                isSelected
                  ? "border-primary bg-primary/5 shadow-xs"
                  : "border-border/80 hover:border-border hover:bg-muted/30"
              )}
            >
              <div className="flex items-start gap-2.5 min-w-0 pr-2">
                <div className="mt-0.5 text-primary shrink-0">
                  {isSelected ? (
                    <CheckCircle2 className="w-4 h-4 fill-primary text-background" />
                  ) : (
                    <Circle className="w-4 h-4 text-muted-foreground/60 group-hover:text-muted-foreground" />
                  )}
                </div>
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        isSelected ? "text-primary" : "text-foreground"
                      )}
                    >
                      {opt.label}
                    </span>
                    {opt.recommended && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-primary/15 text-primary">
                        推荐
                      </span>
                    )}
                    {opt.badge && !opt.recommended && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                        {opt.badge}
                      </span>
                    )}
                  </div>
                  {opt.description && (
                    <p className="text-[11px] text-muted-foreground leading-normal">
                      {opt.description}
                    </p>
                  )}
                </div>
              </div>
              <ChevronRight
                className={cn(
                  "w-4 h-4 transition-transform shrink-0 mt-0.5",
                  isSelected
                    ? "text-primary translate-x-0.5"
                    : "text-muted-foreground/40 group-hover:text-muted-foreground"
                )}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * 步骤任务核对清单：带即时勾选与完成进度条
 */
export const ChecklistCard: React.FC<{
  title: string;
  description?: string;
  items: Array<{ id: string; label: string; checked?: boolean }>;
}> = ({ title, description, items = [] }) => {
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const it of items) init[it.id] = !!it.checked;
    return init;
  });

  const toggle = (id: string) => {
    setCheckedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const total = items.length;
  const doneCount = Object.values(checkedMap).filter(Boolean).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card/90 p-4 shadow-sm my-2.5 max-w-xl text-card-foreground">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <ListTodo className="w-3.5 h-3.5" />
          </div>
          <h4 className="font-semibold text-sm text-foreground">{title}</h4>
        </div>
        <span className="text-xs font-mono font-medium text-muted-foreground tabular-nums">
          {doneCount} / {total} ({pct}%)
        </span>
      </div>

      {description && (
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {description}
        </p>
      )}

      {/* Progress Bar */}
      <div className="w-full bg-muted/60 h-1.5 rounded-full overflow-hidden mb-3">
        <div
          className="bg-primary h-full transition-[width] duration-300 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="space-y-1.5">
        {items.map((it) => {
          const checked = !!checkedMap[it.id];
          return (
            <div
              key={it.id}
              onClick={() => toggle(it.id)}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer select-none text-xs",
                checked
                  ? "bg-muted/30 border-border/50 text-muted-foreground line-through"
                  : "bg-background/80 border-border hover:bg-muted/40 text-foreground"
              )}
            >
              <div className="shrink-0 text-primary">
                {checked ? (
                  <CheckSquare className="w-4 h-4 text-primary" />
                ) : (
                  <div className="w-4 h-4 rounded border border-muted-foreground/60 hover:border-primary transition-colors" />
                )}
              </div>
              <span className="flex-1">{it.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * 指标与统计矩阵卡片
 */
export const MetricsCard: React.FC<{
  title: string;
  description?: string;
  metrics: Array<{
    label: string;
    value: string | number;
    unit?: string;
    change?: string;
    progress?: number;
  }>;
}> = ({ title, description, metrics = [] }) => {
  return (
    <div className="rounded-xl border border-border bg-card/90 p-4 shadow-sm my-2.5 max-w-xl text-card-foreground">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-5 h-5 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <TrendingUp className="w-3.5 h-3.5" />
        </div>
        <h4 className="font-semibold text-sm text-foreground">{title}</h4>
      </div>
      {description && (
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {description}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {metrics.map((m, idx) => (
          <div
            key={idx}
            className="p-3 rounded-lg border border-border bg-background/70 space-y-1"
          >
            <div className="text-[11px] text-muted-foreground truncate font-medium">
              {m.label}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold font-mono text-foreground tabular-nums">
                {m.value}
              </span>
              {m.unit && (
                <span className="text-[10px] text-muted-foreground">{m.unit}</span>
              )}
            </div>
            {m.change && (
              <div className="text-[10px] font-mono text-emerald-400">
                {m.change}
              </div>
            )}
            {typeof m.progress === "number" && (
              <div className="w-full bg-muted/60 h-1 rounded-full overflow-hidden mt-1">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, m.progress))}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * 人机协同动态表单卡片
 */
export const PromptFormCard: React.FC<{
  title: string;
  description?: string;
  submitLabel?: string;
  fields: Array<{
    id: string;
    label: string;
    type?: string;
    placeholder?: string;
    options?: string[];
    defaultValue?: any;
    required?: boolean;
  }>;
  onSubmit?: (values: Record<string, any>) => void;
}> = ({
  title,
  description,
  submitLabel = "提交并继续",
  fields = [],
  onSubmit,
}) => {
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const f of fields) {
      init[f.id] = f.defaultValue !== undefined ? f.defaultValue : "";
    }
    return init;
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    onSubmit?.(formData);
  };

  const update = (id: string, val: any) => {
    setFormData((prev) => ({ ...prev, [id]: val }));
  };

  return (
    <div className="rounded-xl border border-border bg-card/95 p-4 shadow-sm my-2.5 max-w-xl text-card-foreground">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <h4 className="font-semibold text-sm text-foreground">{title}</h4>
        </div>
        {submitted && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-success bg-success/10 px-2 py-0.5 rounded-full">
            <Check className="w-3 h-3" />
            <span>已提交</span>
          </span>
        )}
      </div>

      {description && (
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {description}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {fields.map((f) => (
          <div key={f.id} className="space-y-1">
            <label className="block text-xs font-medium text-foreground">
              {f.label}
              {f.required && <span className="text-destructive ml-0.5">*</span>}
            </label>

            {f.type === "select" ? (
              <select
                disabled={submitted}
                value={formData[f.id] || ""}
                onChange={(e) => update(f.id, e.target.value)}
                className="w-full text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 text-foreground outline-none focus:border-primary disabled:opacity-60 transition-colors"
              >
                <option value="">请选择...</option>
                {(f.options || []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                disabled={submitted}
                rows={3}
                placeholder={f.placeholder}
                value={formData[f.id] || ""}
                onChange={(e) => update(f.id, e.target.value)}
                className="w-full text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 text-foreground outline-none focus:border-primary disabled:opacity-60 transition-colors resize-y"
              />
            ) : f.type === "checkbox" ? (
              <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  disabled={submitted}
                  checked={Boolean(formData[f.id])}
                  onChange={(e) => update(f.id, e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <span>{f.placeholder || f.label}</span>
              </label>
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                disabled={submitted}
                placeholder={f.placeholder}
                value={formData[f.id] || ""}
                onChange={(e) => update(f.id, e.target.value)}
                className="w-full text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 text-foreground outline-none focus:border-primary disabled:opacity-60 transition-colors"
              />
            )}
          </div>
        ))}

        {!submitted && (
          <div className="pt-1 flex justify-end">
            <button
              type="submit"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-xs"
            >
              <Send className="w-3 h-3" />
              <span>{submitLabel}</span>
            </button>
          </div>
        )}
      </form>
    </div>
  );
};
