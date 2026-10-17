import { describe, it, expect } from "vitest";
import { isBootstrapHint, statusTextForUpdate } from "@/lib/agent-status";

/**
 * 状态文案只由真实的 ACP session/update 类型驱动。
 * 这组用例锁住「哪种事件说什么话」，以及「哪些事件不该抢状态位」。
 */
describe("agent status text", () => {
  it("maps session state transitions", () => {
    expect(statusTextForUpdate("state_update", { state: "requires_action" })).toBe("等待确认操作…");
    expect(statusTextForUpdate("state_update", { state: "running" })).toBe("正在生成回复…");
    // idle 由调用方清空状态位，这里不产出文案
    expect(statusTextForUpdate("state_update", { state: "idle" })).toBeNull();
  });

  it("distinguishes tool call lifecycle", () => {
    expect(statusTextForUpdate("tool_call", { title: "读取 src/App.tsx" })).toBe("正在调用 读取 src/App.tsx…");
    expect(statusTextForUpdate("tool_call", {})).toBe("正在调用工具…");
    expect(statusTextForUpdate("tool_call_update", { title: "读取", status: "in_progress" })).toBe("正在执行 读取…");
    expect(statusTextForUpdate("tool_call_update", { title: "读取", status: "completed" })).toBe("读取 已完成");
    expect(statusTextForUpdate("tool_call_update", { title: "读取", status: "failed" })).toBe("读取 失败");
    expect(statusTextForUpdate("tool_call_update", { title: "读取", status: "cancelled" })).toBe("读取 已取消");
  });

  it("shows plan progress from the real entries", () => {
    const entries = [
      { status: "completed" },
      { status: "in_progress" },
      { status: "pending" },
    ];
    expect(statusTextForUpdate("plan", { entries })).toBe("执行计划 1/3");
    expect(statusTextForUpdate("plan_update", { entries })).toBe("执行计划 1/3");
    expect(statusTextForUpdate("plan", { entries: [] })).toBeNull();
  });

  it("covers compaction, subagents and backend notices", () => {
    expect(statusTextForUpdate("compaction_update")).toBe("正在压缩上下文…");
    expect(statusTextForUpdate("subagent_active", { subagentTitle: "检索器" })).toBe("检索器 协同处理中…");
    expect(statusTextForUpdate("subagent_active")).toBe("子智能体 协同处理中…");
    expect(statusTextForUpdate("notice", { message: "  模型繁忙，稍后重试 " })).toBe("模型繁忙，稍后重试");
    expect(statusTextForUpdate("notice", { message: "   " })).toBeNull();
  });

  it("never lets noisy events steal the status slot", () => {
    for (const kind of [
      "agent_message_chunk",
      "agent_thought_chunk",
      "usage_update",
      "available_commands_update",
      "session_info_update",
      "current_mode_update",
      "config_option_update",
      "plan_removed",
      "unknown_future_update",
    ]) {
      expect(statusTextForUpdate(kind)).toBeNull();
    }
  });

  it("recognises bootstrap hints so real events can replace them", () => {
    expect(isBootstrapHint(undefined)).toBe(true);
    expect(isBootstrapHint("正在连接模型思考…")).toBe(true);
    expect(isBootstrapHint("正在建立会话通道…")).toBe(true);
    expect(isBootstrapHint("等待响应…")).toBe(true);
    expect(isBootstrapHint("创建会话…")).toBe(true);
    expect(isBootstrapHint("正在调用 读取…")).toBe(false);
    expect(isBootstrapHint("执行计划 1/3")).toBe(false);
  });
});
