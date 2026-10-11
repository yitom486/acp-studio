import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { AcpAssistantProvider } from "@/components/assistant/AcpAssistantProvider";
import { AcpComposer } from "@/components/assistant/AcpComposer";
import { AssistantChatView } from "@/components/assistant/AssistantChatView";
import { useStudioStore } from "@/stores/useStudioStore";

const composerProps = {
  onSendAttachmentOnly: () => {},
  onClear: () => {},
  isStreaming: false,
  commands: [{ name: "status", description: "查看状态" }],
  supportImage: true,
  attachments: [],
  setAttachments: () => {},
  agentTitle: "Codex",
  configOptions: null,
  connected: true,
  fallbackModels: null,
  fallbackCurrentModel: "",
};

describe("assistant-ui ACP thread (client smoke)", () => {
  it("renders user text, thought, tool call, plan and Diff", async () => {
    useStudioStore.setState({
      messages: [
        { id: "u1", role: "user", content: "你好", timestamp: "03:14" } as any,
        {
          id: "a1",
          role: "assistant",
          content: "你好！我是 Codex。\n\n```ts\nconsole.log(1);\n```\n",
          thought: "正在思考",
          thoughtTiming: { startedAt: 500, completedAt: 4500 },
          toolCalls: [{ id: "t1", title: "read src/App.tsx", kind: "file", status: "completed", startedAt: 1000, completedAt: 4400 }],
          plan: [{ content: "分析", status: "completed" }],
          timestamp: "03:15",
          startedAt: 100,
          completedAt: 5200,
          usage: { used: 39001, size: 258400 },
        } as any,
      ],
      isStreaming: false,
    } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, { agentName: "Codex", onSelectSuggestion: () => {} } as any))
      );
    });
    const html = el.innerHTML;
    expect(html).toContain("你好");
    expect(html).toContain("Codex");
    expect(html).toContain("思考过程");
    expect(html).toContain("执行计划");
    expect(html).toContain("复制");
    expect(html).toContain("animate-fade-slide-in");
    // 用户区无外挂行：时间戳/复制/编辑同处气泡内底部单行，常驻挂载只换透明度
    expect(html).toContain("03:14");
    expect(html).toContain("编辑后重发");
    expect(html).not.toContain("text-muted-foreground/60");
    expect(html).not.toContain("-top-3");
    // 真实耗时：整轮 + 思考（静态文本直出）
    expect(html).toContain("用时 5.1s");
    expect(html).toContain("用时 4.0s");
    // 用量面板：窗口占比 + 进度条，点击展开明细
    expect(html).toContain("context 39,001/258,400");
    expect(html).toContain("15.1%");
    const usageBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("context")
    );
    expect(usageBtn).toBeTruthy();
    await act(async () => {
      usageBtn!.click();
    });
    expect(el.innerHTML).toContain("窗口总量");
    expect(el.innerHTML).toContain("219,399");
    expect(el.innerHTML).toContain("agent 未提供");
    // 工具调用收进折叠组：摘要可见、明细默认收起，点击展开
    expect(html).toContain("工具调用 · 1");
    expect(html).not.toContain("read src/App.tsx");
    const groupBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("工具调用")
    );
    expect(groupBtn).toBeTruthy();
    await act(async () => {
      groupBtn!.click();
    });
    // 文件卡：显示解析出的路径 + 预览区 + Diff + 真实耗时
    expect(el.innerHTML).toContain("src/App.tsx");
    expect(el.innerHTML).toContain("Diff");
    // 工具行真实耗时（3400ms -> 3.4s）
    expect(el.innerHTML).toContain("3.4s");
    root.unmount();
    el.remove();
  });

  it("renders ACP composer with placeholder, send and model fallback", async () => {
    useStudioStore.setState({ messages: [], isStreaming: false } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AcpComposer, composerProps as any))
      );
    });
    const html = el.innerHTML;
    expect(html).toContain("随便问点什么");
    expect(html).toContain("发送");
    expect(html).toContain("点击加载模型");
    root.unmount();
    el.remove();
  });

  it("renders model/thinking/permission selectors when session config exists", async () => {
    useStudioStore.setState({ messages: [], isStreaming: false } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AcpComposer, {
            ...composerProps,
            configOptions: [
              { id: "model", name: "模型", type: "select", currentValue: "gpt-5", options: [{ value: "gpt-5", name: "GPT-5" }, { value: "gpt-4", name: "GPT-4" }] },
              { id: "reasoning_effort", name: "思考", type: "select", currentValue: "high", options: [{ value: "high", name: "High" }] },
              { id: "mode", name: "权限", type: "select", currentValue: "auto", options: [{ value: "auto", name: "自动" }] },
            ],
          } as any))
      );
    });
    const html = el.innerHTML;
    expect(html).toContain("GPT-5");
    expect(html).toContain("High");
    expect(html).toContain("自动");
    expect(html).not.toContain("点击加载模型");
    expect(html).not.toContain("思考：—");
    root.unmount();
    el.remove();
  });

  it("shows a compact capsule before the first token", async () => {
    useStudioStore.setState({
      messages: [
        { id: "a0", role: "assistant", content: "", timestamp: "15:49", isStreaming: true } as any,
      ],
      isStreaming: true,
    } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, { agentName: "Codex", onSelectSuggestion: () => {} } as any))
      );
    });
    // 紧凑胶囊：有思考提示、无整卡头部（无标题栏时间戳/生成中/骨架卡）
    expect(el.innerHTML).toContain("正在思考");
    expect(el.innerHTML).not.toContain("生成中");
    expect(el.innerHTML).not.toContain("15:49");
    root.unmount();
    el.remove();
    useStudioStore.setState({ messages: [], isStreaming: false } as any);
  });

  it("shows cache hit rate only when the agent provides it", async () => {
    useStudioStore.setState({
      messages: [
        {
          id: "a2",
          role: "assistant",
          content: "答复",
          timestamp: "03:16",
          usage: { used: 10000, size: 200000, cachedTokens: 6000, totalTokens: 10000 },
        } as any,
      ],
      isStreaming: false,
    } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, { agentName: "Codex", onSelectSuggestion: () => {} } as any))
      );
    });
    // 摘要行即见缓存命中率
    expect(el.innerHTML).toContain("缓存 60.0%");
    const usageBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("context")
    );
    await act(async () => {
      usageBtn!.click();
    });
    expect(el.innerHTML).toContain("6,000/10,000");
    root.unmount();
    el.remove();
    useStudioStore.setState({ messages: [], isStreaming: false } as any);
  });

  it("shows a loading shimmer while the session builds", async () => {
    useStudioStore.setState({ messages: [], isStreaming: false } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AcpComposer, { ...composerProps, sessionLoading: true } as any))
      );
    });
    expect(el.innerHTML).toContain("模型加载中");
    expect(el.innerHTML).not.toContain("点击加载模型");
    root.unmount();
    el.remove();
  });

  it("shows a session banner with retry when creation fails", async () => {
    useStudioStore.setState({ messages: [], isStreaming: false } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, {
            agentName: "Codex",
            onSelectSuggestion: () => {},
            connected: true,
            sessionId: null,
            sessionError: "网关超时",
            onEnsureSession: () => {},
          } as any))
      );
    });
    expect(el.innerHTML).toContain("建会话失败");
    expect(el.innerHTML).toContain("网关超时");
    expect(el.innerHTML).toContain("重试");
    root.unmount();
    el.remove();
  });

  it("renders tables via remark-gfm with ACP styling", async () => {
    useStudioStore.setState({
      messages: [
        {
          id: "a4",
          role: "assistant",
          content: "对比如下：\n\n| 方案 | 成本 |\n| --- | --- |\n| A | 低 |\n",
          timestamp: "03:18",
        } as any,
      ],
      isStreaming: false,
    } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, { agentName: "Codex", onSelectSuggestion: () => {} } as any))
      );
    });
    expect(el.querySelector("table")).toBeTruthy();
    expect(el.innerHTML).toContain("方案");
    expect(el.innerHTML).toContain("低");
    root.unmount();
    el.remove();
    useStudioStore.setState({ messages: [], isStreaming: false } as any);
  });

  it("renders a mermaid fence through the lazy diagram renderer", async () => {
    useStudioStore.setState({
      messages: [
        {
          id: "a3",
          role: "assistant",
          content: "流程如下：\n\n```mermaid\nflowchart LR\n  A-->B\n```\n",
          timestamp: "03:17",
        } as any,
      ],
      isStreaming: false,
    } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, { agentName: "Codex", onSelectSuggestion: () => {} } as any))
      );
      await new Promise((r) => setTimeout(r, 200));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    // 图表容器（或其加载/回退态）必须出现，而不是裸代码
    const html = el.innerHTML;
    expect(html).toContain("data-mermaid-block");
    expect(html).toContain("mermaid");
    root.unmount();
    el.remove();
    useStudioStore.setState({ messages: [], isStreaming: false } as any);
  });

  it("floats the scroll-to-bottom button with zero layout footprint", async () => {
    useStudioStore.setState({
      messages: [{ id: "u1", role: "user", content: "hi", timestamp: "03:14" } as any],
      isStreaming: false,
    } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, { agentName: "Codex", onSelectSuggestion: () => {} } as any))
      );
    });
    const btn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("回到底部")
    );
    expect(btn).toBeTruthy();
    // 浮层：不占文档流，显隐不再挤压上方消息
    expect(btn!.className).toContain("absolute");
    expect(btn!.className).toContain("pointer-events-auto");
    const footer = btn!.parentElement;
    expect(footer!.className).toContain("pointer-events-none");
    expect(footer!.className).toContain("h-0");
    root.unmount();
    el.remove();
    useStudioStore.setState({ messages: [], isStreaming: false } as any);
  });

  it("shows a turn-changes entry only for edit-kind tool calls", async () => {
    useStudioStore.setState({
      messages: [
        {
          id: "a7", role: "assistant", content: "改完了", timestamp: "03:21",
          toolCalls: [{ id: "t1", title: "edit a.ts", kind: "edit", status: "completed" }],
        } as any,
      ],
      isStreaming: false,
    } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, { agentName: "Codex", onSelectSuggestion: () => {} } as any))
      );
    });
    expect(el.innerHTML).toContain("改动 1");
    root.unmount();
    el.remove();

    useStudioStore.setState({
      messages: [
        {
          id: "a8", role: "assistant", content: "读完了", timestamp: "03:22",
          toolCalls: [{ id: "t2", title: "read a.ts", kind: "read", status: "completed" }],
        } as any,
      ],
      isStreaming: false,
    } as any);
    const el2 = document.createElement("div");
    document.body.appendChild(el2);
    const root2 = createRoot(el2);
    await act(async () => {
      root2.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, { agentName: "Codex", onSelectSuggestion: () => {} } as any))
      );
    });
    expect(el2.innerHTML).not.toContain("改动");
    root2.unmount();
    el2.remove();
    useStudioStore.setState({ messages: [], isStreaming: false } as any);
  });

  it("paginates long histories with a load-earlier button", async () => {
    const many = Array.from({ length: 35 }, (_, i) => ({
      id: `m-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `消息 ${i}`,
      timestamp: "03:14",
    }));
    useStudioStore.setState({ messages: many, isStreaming: false } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, { agentName: "Codex", onSelectSuggestion: () => {} } as any))
      );
    });
    // Latest page visible + earlier loader offered; oldest message withheld.
    expect(el.innerHTML).toContain("加载更早的消息");
    expect(el.innerHTML).toContain("消息 34");
    expect(el.innerHTML).not.toContain("消息 0");
    root.unmount();
    el.remove();
  });

  it("renders permission approval inline in the matching tool card", async () => {
    useStudioStore.setState({
      sessionId: "sess1",
      messages: [
        {
          id: "a9",
          role: "assistant",
          content: "正在执行",
          toolCalls: [{ id: "t1", title: "rm -rf /tmp/x", kind: "terminal", status: "running" }],
          timestamp: "03:15",
        },
      ],
      pendingPerms: [
        {
          permissionId: "perm1",
          agentId: "codex",
          sessionId: "sess1",
          toolCall: { toolCallId: "t1", title: "rm -rf /tmp/x" },
          options: [{ optionId: "allow", name: "允许", kind: "allow" }],
        },
      ],
      isStreaming: false,
    } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(AcpAssistantProvider, { onSend: () => {}, onStop: () => {} } as any,
          h(AssistantChatView, { agentName: "Codex", onSelectSuggestion: () => {} } as any))
      );
    });
    expect(el.innerHTML).toContain("需要授权");
    expect(el.innerHTML).toContain("允许");
    expect(el.innerHTML).toContain("拒绝");
    root.unmount();
    el.remove();
    useStudioStore.setState({ pendingPerms: [], sessionId: null } as any);
  });
});
