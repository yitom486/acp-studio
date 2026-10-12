import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { StudioHeader } from "../../src/components/universal/StudioHeader";

describe("StudioHeader modern UI", () => {
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
    // pid / auth details live in the agent chip popover; the chip itself stays one line.
    expect(html).toContain('data-testid="agent-chip"');
    expect(html).not.toContain("pid 57124");
    expect(html).toContain("已认证");
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("新会话");
    expect(html).toContain("变更");
  });
});
