import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { ChatArea, type Message } from "../../src/components/ChatArea";
import { StudioHeader } from "../../src/components/universal/StudioHeader";

describe("ChatArea & StudioHeader modern UI", () => {
  it("renders user bubble with valid padding, break-words, and no overflow bugs", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "user",
        content: "你好，可以介绍一下你自己吗请问",
        timestamp: "03:14",
      },
    ];

    const html = renderToString(
      h(ChatArea, {
        messages,
        isStreaming: false,
        selectedModel: "Codex",
        selectedMode: "default",
        onSelectSuggestion: () => {},
        agentName: "Codex",
      })
    );

    // User message content is rendered
    expect(html).toContain("你好，可以介绍一下你自己吗请问");
    // Standard valid padding and word wrapping
    expect(html).toContain("px-4 py-2.5");
    expect(html).toContain("break-words");
    expect(html).toContain("rounded-tr-xs");
    // Must NOT contain the invalid Tailwind p-4.5
    expect(html).not.toContain("p-4.5");
    // User bubble no longer contains redundant "You" header
    expect(html).not.toMatch(/<span[^>]*>You<\/span>/);
  });

  it("renders assistant bubble with valid padding and clean layout", () => {
    const messages: Message[] = [
      {
        id: "msg-2",
        role: "assistant",
        content: "你好！我是 Codex。",
        timestamp: "03:15",
        thought: "正在思考...",
      },
    ];

    const html = renderToString(
      h(ChatArea, {
        messages,
        isStreaming: false,
        selectedModel: "Codex",
        selectedMode: "default",
        onSelectSuggestion: () => {},
        agentName: "Codex",
      })
    );

    expect(html).toContain("你好！我是 Codex。");
    expect(html).toContain("Codex");
    expect(html).toContain("p-4 sm:p-5");
    expect(html).not.toContain("p-4.5");
  });

  it("StudioHeader renders clean 52px single header with agent selector, title, and actions", () => {
    const html = renderToString(
      h(StudioHeader, {
        agents: [
          {
            id: "codex",
            name: "Codex",
            title: "Codex (OpenAI)",
            description: "Agent",
            status: { connected: true, pid: 57124, protocolVersion: 1 },
          },
        ],
        activeAgentId: "codex",
        onSelectAgent: () => {},
        onConnect: () => {},
        connecting: false,
        onOpenAuth: () => {},
        onLogout: () => {},
        authOk: true,
        sessionId: "01a0c546-de7b-72c2",
        sessionTitle: "自我介绍请求",
        usage: { used: 3420, size: 200000 },
        hasChangesCwd: true,
        supportsFork: true,
        supportsProviders: true,
        busy: false,
        isStreaming: false,
        onNewSession: () => {},
        onForkSession: () => {},
        onOpenProviders: () => {},
        onOpenChanges: () => {},
        onCloseSession: () => {},
        onDeleteSession: () => {},
        onClearMessages: () => {},
      })
    );

    expect(html).toContain("ACP Studio");
    expect(html).toContain("Codex (OpenAI)");
    expect(html).toContain("自我介绍请求");
    expect(html).toContain("pid 57124");
    expect(html).toContain("已认证");
    expect(html).toContain("新会话");
    expect(html).toContain("变更");
  });
});
