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

