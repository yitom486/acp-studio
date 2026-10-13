import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { QuotaRing, QuotaCard, type UniversalQuotaState } from "../../src/components/universal/QuotaCard";
import { StudioHeader, AgentStatusChip } from "../../src/components/universal/StudioHeader";

describe("Quota UI components and StudioHeader integration", () => {
  it("renders QuotaRing with stroke-dashoffset and correct tone", () => {
    // > 40% -> emerald
    const htmlHigh = renderToString(h(QuotaRing, { percentLeft: 85 }));
    expect(htmlHigh).toContain("text-emerald-500");
    expect(htmlHigh).toContain('aria-label="配额剩余 85%"');

    // 20-40% -> amber
    const htmlMid = renderToString(h(QuotaRing, { percentLeft: 30 }));
    expect(htmlMid).toContain("text-amber-500");
    expect(htmlMid).toContain('aria-label="配额剩余 30%"');

    // < 15% -> rose
    const htmlLow = renderToString(h(QuotaRing, { percentLeft: 8 }));
    expect(htmlLow).toContain("text-rose-500");
    expect(htmlLow).toContain('aria-label="配额剩余 8%"');
  });

  it("renders full QuotaCard with account, 5h limit, weekly limit, and credits", () => {
    const mockQuota: UniversalQuotaState = {
      runtimeId: "codex-acp",
      account: {
        email: "yitom486@gmail.com",
        plan: "ChatGPT Plus",
      },
      primaryWindow: {
        label: "5-hour limit",
        percentLeft: 45,
        resetsAt: "Resets in 2h 45m",
      },
      secondaryWindow: {
        label: "Weekly limit",
        percentLeft: 92,
        resetsAt: "Resets tomorrow at 12:45",
      },
      credits: {
        balance: "unlimited",
        unlimited: true,
      },
      status: "ok",
    };

    const html = renderToString(
      h(QuotaCard, {
        quota: mockQuota,
        agentTitle: "Codex",
        agentId: "codex",
        canSendStatus: true,
        onSendStatus: () => {},
      })
    );

    expect(html).toContain("ChatGPT Plus");
    expect(html).toContain("yitom486@gmail.com");
    expect(html).toContain("5-hour limit");
    expect(html).toContain("45");
    expect(html).toContain("剩余");
    expect(html).toContain("重置: 2h 45m");
    expect(html).toContain("Weekly limit");
    expect(html).toContain("92");
    expect(html).toContain("重置: tomorrow at 12:45");
    expect(html).toContain("账户余额 / Credits");
    expect(html).toContain("无限制 (Unlimited)");
  });

  it("renders empty state in QuotaCard gracefully when quota is null", () => {
    const html = renderToString(
      h(QuotaCard, {
        quota: null,
        agentTitle: "Antigravity",
        agentId: "agy",
      })
    );

    expect(html).toContain("配额与速率限制");
    expect(html).toContain("暂未探测到本地额度数据");
  });

  it("renders AgentStatusChip with quota indicator when agent status carries quota", () => {
    const html = renderToString(
      h(AgentStatusChip, {
        agents: [
          {
            id: "codex",
            name: "Codex",
            title: "Codex (OpenAI)",
            status: {
              connected: true,
              quota: {
                runtimeId: "codex-acp",
                primaryWindow: {
                  label: "5-hour limit",
                  percentLeft: 60,
                  resetsAt: "3h",
                },
              },
            },
          },
        ],
        activeAgentId: "codex",
        onSelectAgent: () => {},
        onConnect: () => {},
        connecting: false,
        onOpenAuth: () => {},
        onLogout: () => {},
        authOk: true,
      })
    );

    expect(html).toContain('data-testid="agent-chip"');
    expect(html).toContain("Codex (OpenAI)");
    // Should render the mini QuotaRing SVG
    expect(html).toContain('aria-label="配额剩余 60%"');
  });
});
