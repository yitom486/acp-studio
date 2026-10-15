import React from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  DecisionCard,
  ChecklistCard,
  MetricsCard,
  PromptFormCard,
} from "./GenerativeCards";
import { ReactArtifactCard } from "./ReactArtifactCard";
import {
  EditorialDiagramCard,
  DiagramType,
  AccentColor,
} from "./EditorialDiagramCard";

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
 * 规范化生成式工具名：自动剥离各种代理客户端可能添加的命名空间前缀
 * 如 "studio-ui_show_interactive_card", "studio-ui.render_editorial_diagram", "studio-ui/show_interactive_card"
 */
export function normalizeGenerativeToolName(name?: string): string {
  if (!name) return "";
  let clean = name.trim().toLowerCase();
  clean = clean.replace(/^studio[-_]ui[:_./]/i, "");
  return clean;
}

export function isGenerativeTool(tcOrName: any): boolean {
  if (!tcOrName) return false;
  const raw = typeof tcOrName === "string" ? tcOrName : (tcOrName.name || tcOrName.title || "");
  const clean = normalizeGenerativeToolName(raw);
  return (
    clean === "show_interactive_card" ||
    clean === "render_editorial_diagram" ||
    clean === "render_react_sandbox" ||
    clean === "prompt_form"
  );
}

export function parseToolArgs(rawInput: unknown): Record<string, any> {
  if (rawInput && typeof rawInput === "object") return rawInput as Record<string, any>;
  if (typeof rawInput === "string") {
    try {
      const parsed = JSON.parse(rawInput);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ignore
    }
  }
  return {};
}

/**
 * 独立直接渲染组件：脱离 assistant-ui 内部深层 tool context 依赖，
 * 直接从 ACP 消息的 toolCalls 渲染富交互卡片。
 */
export const AcpGenerativeToolCard: React.FC<{
  tool: any;
  onAction?: (result: any) => void;
}> = ({ tool, onAction }) => {
  const normName = normalizeGenerativeToolName(tool?.name || tool?.title);
  const args = parseToolArgs(tool?.rawInput);

  if (normName === "show_interactive_card") {
    const { title = "交互卡片", cardType = "decision", description, data = {} } = args;
    if (cardType === "decision") {
      const options = Array.isArray(data.options) ? data.options : [];
      return (
        <div className="my-2.5">
          <DecisionCard
            title={title}
            description={description}
            options={options}
            onSelect={(choiceId) => onAction?.({ status: "selected", choiceId })}
          />
        </div>
      );
    }
    if (cardType === "checklist") {
      const items = Array.isArray(data.items) ? data.items : [];
      return (
        <div className="my-2.5">
          <ChecklistCard title={title} description={description} items={items} />
        </div>
      );
    }
    if (cardType === "metrics") {
      const metrics = Array.isArray(data.metrics) ? data.metrics : [];
      return (
        <div className="my-2.5">
          <MetricsCard title={title} description={description} metrics={metrics} />
        </div>
      );
    }
    if (cardType === "form") {
      const fields = Array.isArray(data.fields) ? data.fields : [];
      return (
        <div className="my-2.5">
          <PromptFormCard
            title={title}
            description={description}
            fields={fields}
            onSubmit={(formValues) => onAction?.({ status: "submitted", values: formValues })}
          />
        </div>
      );
    }
  }

  if (normName === "render_editorial_diagram") {
    if (!args.title && !args.diagramType) return null;
    return (
      <div className="my-3">
        <EditorialDiagramCard
          title={args.title || "系统流程架构"}
          diagramType={args.diagramType || "sequence"}
          description={args.description}
          theme={args.theme || "system"}
          accent={args.accent || "emerald"}
          data={args.data || {}}
        />
      </div>
    );
  }

  if (normName === "render_react_sandbox") {
    if (!args.code) return null;
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
    return (
      <div className="my-2.5">
        <PromptFormCard
          title={args.title || "配置填报"}
          description={args.description}
          submitLabel={args.submitLabel}
          fields={args.fields || []}
          onSubmit={(formValues) => onAction?.({ status: "submitted", values: formValues })}
        />
      </div>
    );
  }

  return null;
};

