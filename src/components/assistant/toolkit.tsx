import React from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  DecisionCard,
  ChecklistCard,
  MetricsCard,
  PromptFormCard,
} from "./GenerativeCards";
import { ReactArtifactCard } from "./ReactArtifactCard";
import { Sparkles } from "lucide-react";
import {
  EditorialDiagramCard,
  DiagramType,
  AccentColor,
} from "./EditorialDiagramCard";
import type { GenerativeCardAction } from "@/lib/present-result";

export type { GenerativeCardAction };


/**
 * 1. 结构化交互卡片工具 UI
 */
export const ShowInteractiveCardToolUI = makeAssistantToolUI<
  {
    title: string;
    cardType?: "decision" | "metrics" | "checklist" | "form";
    description?: string;
    data?: Record<string, any>;
  },
  any
>({
  toolName: "show_interactive_card",
  render: ({ args, addResult }) => {
    const { title = "交互卡片", cardType = "decision", description, data = {} } = args || {};

    if (cardType === "decision") {
      const options = Array.isArray(data.options) ? data.options : [];
      return (
        <DecisionCard
          title={title}
          description={description}
          options={options}
          onSelect={(choiceId) => {
            addResult?.({ status: "selected", choiceId });
          }}
        />
      );
    }

    if (cardType === "checklist") {
      const items = Array.isArray(data.items) ? data.items : [];
      return (
        <ChecklistCard
          title={title}
          description={description}
          items={items}
        />
      );
    }

    if (cardType === "metrics") {
      const metrics = Array.isArray(data.metrics) ? data.metrics : [];
      return (
        <MetricsCard
          title={title}
          description={description}
          metrics={metrics}
        />
      );
    }

    if (cardType === "form") {
      const fields = Array.isArray(data.fields) ? data.fields : [];
      return (
        <PromptFormCard
          title={title}
          description={description}
          fields={fields}
          onSubmit={(formValues) => {
            addResult?.({ status: "submitted", values: formValues });
          }}
        />
      );
    }

    return null;
  },
});

/**
 * 2. 自由 React / HTML 沙箱原型工具 UI
 */
export const RenderReactSandboxToolUI = makeAssistantToolUI<
  {
    title?: string;
    code: string;
    template?: "react" | "html";
    description?: string;
  },
  any
>({
  toolName: "render_react_sandbox",
  render: ({ args }) => {
    if (!args || !args.code) return null;
    return (
      <ReactArtifactCard
        code={args.code}
        template={args.template || "react"}
        title={args.title || "React 原型预览"}
        description={args.description}
      />
    );
  },
});

/**
 * 3. 人机协同表单输入工具 UI
 */
export const PromptFormToolUI = makeAssistantToolUI<
  {
    title: string;
    description?: string;
    submitLabel?: string;
    fields: Array<any>;
  },
  any
>({
  toolName: "prompt_form",
  render: ({ args, addResult }) => {
    const { title = "输入表单", description, submitLabel, fields = [] } = args || {};
    return (
      <PromptFormCard
        title={title}
        description={description}
        submitLabel={submitLabel}
        fields={fields}
        onSubmit={(formValues) => {
          addResult?.({ status: "submitted", values: formValues });
        }}
      />
    );
  },
});

/**
 * 4. 出版级精美图表 (Editorial Diagram) 工具 UI
 */
export const RenderEditorialDiagramToolUI = makeAssistantToolUI<
  {
    title: string;
    diagramType: DiagramType;
    description?: string;
    theme?: "light" | "dark" | "system";
    accent?: AccentColor;
    data: Record<string, any>;
  },
  any
>({
  toolName: "render_editorial_diagram",
  render: ({ args }) => {
    if (!args || !args.title) return null;
    return (
      <EditorialDiagramCard
        title={args.title}
        diagramType={args.diagramType || "architecture"}
        description={args.description}
        theme={args.theme || "system"}
        accent={args.accent || "emerald"}
        data={args.data || {}}
      />
    );
  },
});

/**
 * 组合注册组件：挂载到 AssistantRuntimeProvider 内部即可自动拦截对应 tool calls
 */
export const StudioGenerativeToolUIs: React.FC = () => {
  return (
    <>
      <ShowInteractiveCardToolUI />
      <RenderReactSandboxToolUI />
      <PromptFormToolUI />
      <RenderEditorialDiagramToolUI />
    </>
  );
};

/**
 * 规范化生成式工具名：支持多种代理客户端的调用和命名格式，包括：
 * - "render_editorial_diagram"
 * - "studio-ui_render_editorial_diagram"
 * - "studio-ui.render_editorial_diagram"
 * - "studio-ui/render_editorial_diagram"
 * - "tools[\"studio-ui\"].render_editorial_diagram"
 * - "await tools[\"studio-ui\"].render_editorial_diagram({ ... })"
 */
export function normalizeGenerativeToolName(name?: string): string {
  if (!name || typeof name !== "string") return "";
  const str = name.trim();

  // 1. 优先使用边界词匹配 4 大原生生成式工具名
  const match = str.match(/\b(render_editorial_diagram|show_interactive_card|render_react_sandbox|prompt_form)\b/i);
  if (match) {
    return match[1].toLowerCase();
  }

  // 2. 剥离可能的代理调用前缀与参数括号
  let clean = str.toLowerCase();
  clean = clean.replace(/^.*tools\s*\[\s*["']?studio[-_]ui["']?\s*\]\.?/i, "");
  clean = clean.replace(/^studio[-_]ui[:_./]/i, "");
  clean = clean.split(/[({\s]/)[0];
  return clean;
}

export function isGenerativeTool(tcOrName: any): boolean {
  if (!tcOrName) return false;
  if (typeof tcOrName === "string") {
    const clean = normalizeGenerativeToolName(tcOrName);
    return isGenerativeToolName(clean);
  }
  const candidates = [
    tcOrName.name,
    tcOrName.title,
    tcOrName.id,
    tcOrName.kind,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && isGenerativeToolName(normalizeGenerativeToolName(c))) {
      return true;
    }
  }
  return false;
}

function isGenerativeToolName(clean: string): boolean {
  return (
    clean === "show_interactive_card" ||
    clean === "render_editorial_diagram" ||
    clean === "render_react_sandbox" ||
    clean === "prompt_form"
  );
}

/**
 * 安全解析 JSON 或 JS 对象字面量（例如 { title: "OAuth2", ... }）
 */
export function safeEvalObject(str: unknown): Record<string, any> | null {
  if (!str) return null;
  if (typeof str === "object") return str as Record<string, any>;
  if (typeof str !== "string") return null;

  const trimmed = str.trim();
  if (!trimmed) return null;

  // 1. 尝试直接 JSON.parse
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}

  // 2. 尝试解析 JS 对象字面量 (如无引号 key 的 { title: "..." })
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const fn = new Function(`"use strict"; return (${trimmed});`);
      const evaluated = fn();
      if (evaluated && typeof evaluated === "object") return evaluated;
    } catch {}
  }

  return null;
}

/**
 * 健壮提取生成式工具的入参与数据：
 * 依次扫描 rawInput、input、args、parameters、rawOutput.data、content 与 title 调用表达式
 */
export function extractToolArgs(tool: any): Record<string, any> {
  if (!tool) return {};

  const result: Record<string, any> = {};

  // 1. 优先扫描入参字段（rawInput / input / args / arguments / parameters / params）
  const candidateInputs = [
    tool.rawInput,
    tool.input,
    tool.args,
    tool.arguments,
    tool.parameters,
    tool.params,
  ];
  for (const c of candidateInputs) {
    const parsed = safeEvalObject(c);
    if (parsed) {
      Object.assign(result, parsed);
      break;
    }
  }

  // 2. 扫描出参字段（MCP Server 返回的 data: { title, diagramType, data... }）
  const candidateOutputs = [
    tool.rawOutput,
    tool.output,
    tool.result,
    tool.data,
  ];
  for (const o of candidateOutputs) {
    if (o && typeof o === "object") {
      if (o.structuredContent && typeof o.structuredContent === "object") {
        Object.assign(result, o.structuredContent);
      } else if (o.data && typeof o.data === "object") {
        Object.assign(result, o.data);
      } else {
        Object.assign(result, o);
      }
      break;
    }
    const parsed = safeEvalObject(o);
    if (parsed) {
      if (parsed.data && typeof parsed.data === "object") {
        Object.assign(result, parsed.data);
      } else {
        Object.assign(result, parsed);
      }
      break;
    }
  }

  // 3. 扫描 ACP content 数组
  if (Array.isArray(tool.content)) {
    for (const chunk of tool.content) {
      if (chunk?.type === "text" && typeof chunk.text === "string") {
        const parsed = safeEvalObject(chunk.text);
        if (parsed) Object.assign(result, parsed);
      } else if (chunk?.data && typeof chunk.data === "object") {
        Object.assign(result, chunk.data);
      }
    }
  }

  // 4. 从 title 或 name 中的函数调用语句提取实参
  // 例如：await tools["studio-ui"].render_editorial_diagram({ title: "OAuth2", ... })
  for (const strCandidate of [tool.title, tool.name]) {
    if (typeof strCandidate === "string" && strCandidate.includes("(")) {
      const startIdx = strCandidate.indexOf("(");
      const endIdx = strCandidate.lastIndexOf(")");
      if (startIdx !== -1 && endIdx > startIdx) {
        const callArgsStr = strCandidate.slice(startIdx + 1, endIdx).trim();
        const parsed = safeEvalObject(callArgsStr);
        if (parsed) {
          // 不覆盖已有字段，作为初始补全
          for (const [k, v] of Object.entries(parsed)) {
            if (result[k] === undefined) {
              result[k] = v;
            }
          }
        }
      }
    }
  }

  return result;
}

export function parseToolArgs(rawInput: unknown): Record<string, any> {
  if (rawInput && typeof rawInput === "object") {
    return extractToolArgs({ rawInput });
  }
  return extractToolArgs({ rawInput });
}

const GenerativeSkeleton: React.FC<{ title: string; hint: string }> = ({ title, hint }) => {
  return (
    <div className="my-3 rounded-xl border border-line bg-surface/75 p-4 animate-pulse select-none">
      <div className="flex items-center gap-2 text-xs font-medium text-ink">
        <Sparkles className="w-3.5 h-3.5 text-accent animate-spin" />
        <span className="font-semibold">{title}</span>
        <span className="text-[11px] text-ink-3">({hint})</span>
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-3 w-3/4 rounded bg-muted/40" />
        <div className="h-20 w-full rounded bg-muted/20" />
      </div>
    </div>
  );
};

/**
 * 独立直接渲染组件：脱离 assistant-ui 内部深层 tool context 依赖，
 * 直接从 ACP 消息的 toolCalls 渲染富交互卡片。
 */
export const AcpGenerativeToolCard: React.FC<{
  tool: any;
  onAction?: (action: GenerativeCardAction) => void | Promise<void>;
}> = ({ tool, onAction }) => {
  const normName = normalizeGenerativeToolName(tool?.name || tool?.title);
  const args = extractToolArgs(tool);
  const isPending = tool?.status === "pending" || tool?.status === "running";

  if (normName === "show_interactive_card") {
    const title = args.title || "方案对比与决策";
    const cardType = args.cardType || "decision";
    const description = args.description;
    const data = args.data && typeof args.data === "object" ? args.data : args;

    if (cardType === "decision") {
      const options = Array.isArray(data.options)
        ? data.options
        : Array.isArray(args.options)
          ? args.options
          : [];
      if (options.length === 0 && isPending) {
        return <GenerativeSkeleton title={title} hint="正在生成方案决策卡片…" />;
      }
      return (
        <div className="my-2.5">
          <DecisionCard
            title={title}
            description={description}
            options={options}
            onSelect={async (choiceId, opt) => {
              await onAction?.({
                type: "decision",
                resultId: args.id || tool?.id,
                title,
                choiceId,
                choiceLabel: opt?.label,
                toolCallId: tool?.id,
              });
            }}
          />
        </div>
      );
    }
    if (cardType === "checklist") {
      const items = Array.isArray(data.items)
        ? data.items
        : Array.isArray(args.items)
          ? args.items
          : [];
      if (items.length === 0 && isPending) {
        return <GenerativeSkeleton title={title} hint="正在生成检查清单…" />;
      }
      return (
        <div className="my-2.5">
          <ChecklistCard title={title} description={description} items={items} />
        </div>
      );
    }
    if (cardType === "metrics") {
      const metrics = Array.isArray(data.metrics)
        ? data.metrics
        : Array.isArray(args.metrics)
          ? args.metrics
          : [];
      if (metrics.length === 0 && isPending) {
        return <GenerativeSkeleton title={title} hint="正在生成指标看板…" />;
      }
      return (
        <div className="my-2.5">
          <MetricsCard title={title} description={description} metrics={metrics} />
        </div>
      );
    }
    if (cardType === "form") {
      const fields = Array.isArray(data.fields)
        ? data.fields
        : Array.isArray(args.fields)
          ? args.fields
          : [];
      if (fields.length === 0 && isPending) {
        return <GenerativeSkeleton title={title} hint="正在构建交互表单…" />;
      }
      return (
        <div className="my-2.5">
          <PromptFormCard
            title={title}
            description={description}
            fields={fields}
            onSubmit={async (formValues) => {
              await onAction?.({
                type: "form",
                resultId: args.id || tool?.id,
                title,
                values: formValues,
                toolCallId: tool?.id,
              });
            }}
          />
        </div>
      );
    }
  }

  if (normName === "render_editorial_diagram") {
    const title = args.title || "系统流程架构";
    const diagramType = args.diagramType || "architecture";
    const data =
      args.data && typeof args.data === "object" && Object.keys(args.data).length > 0
        ? args.data
        : args;

    if (!args.title && !args.diagramType && isPending) {
      return <GenerativeSkeleton title="架构时序图表" hint="正在生成出版级矢量图表…" />;
    }

    return (
      <div className="my-3">
        <EditorialDiagramCard
          title={title}
          diagramType={diagramType}
          description={args.description}
          theme={args.theme || "system"}
          accent={args.accent || "emerald"}
          data={data}
        />
      </div>
    );
  }

  if (normName === "render_react_sandbox") {
    if (!args.code) {
      if (isPending) return <GenerativeSkeleton title={args.title || "动态组件原型"} hint="正在加载沙箱组件…" />;
      return null;
    }
    return (
      <div className="my-3">
        <ReactArtifactCard
          code={args.code}
          template={args.template || "react"}
          title={args.title || "动态组件原型"}
          description={args.description}
        />
      </div>
    );
  }

  if (normName === "prompt_form") {
    const fields = Array.isArray(args.fields)
      ? args.fields
      : Array.isArray(args.data?.fields)
        ? args.data.fields
        : [];
    if (fields.length === 0 && isPending) {
      return <GenerativeSkeleton title={args.title || "配置填报"} hint="正在准备人机表单…" />;
    }
    return (
      <div className="my-2.5">
        <PromptFormCard
          title={args.title || "配置填报"}
          description={args.description}
          submitLabel={args.submitLabel}
          fields={fields}
          onSubmit={async (formValues) => {
            await onAction?.({
              type: "form",
              resultId: args.id || tool?.id,
              title: args.title || "配置填报",
              values: formValues,
              toolCallId: tool?.id,
            });
          }}
        />
      </div>
    );
  }

  return null;
};

