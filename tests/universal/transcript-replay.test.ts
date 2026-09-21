import { describe, it, expect } from "vitest";
import { extractText, buildTranscriptFromReplay } from "../../src/lib/universal-api";

describe("Polymorphic Content Parser (extractText)", () => {
  it("extracts plain strings directly", () => {
    expect(extractText("hello world")).toBe("hello world");
    expect(extractText("")).toBe("");
  });

  it("extracts direct text property { text: '...' } (Codex style)", () => {
    expect(extractText({ text: "查找 C 盘空间占用来源" })).toBe("查找 C 盘空间占用来源");
  });

  it("extracts standard ACP typed chunk { type: 'text', text: '...' }", () => {
    expect(extractText({ type: "text", text: "ACP response chunk" })).toBe("ACP response chunk");
  });

  it("extracts nested content wrappers { content: { text: '...' } }", () => {
    expect(extractText({ content: { text: "nested prompt" } })).toBe("nested prompt");
    expect(extractText({ content: { type: "text", text: "nested typed prompt" } })).toBe("nested typed prompt");
  });

  it("extracts arrays of content blocks", () => {
    const blocks = [
      { text: "part 1 " },
      { type: "text", text: "part 2" },
      "part 3",
    ];
    expect(extractText(blocks)).toBe("part 1 part 2part 3");
  });

  it("handles null and undefined gracefully", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
    expect(extractText({})).toBe("");
  });
});

describe("Transcript Rebuilder (buildTranscriptFromReplay)", () => {
  it("recovers user prompt even when content lacks type: 'text' (Codex user_message_chunk)", () => {
    const replayed = [
      {
        sessionUpdate: "user_message_chunk",
        messageId: "msg-user-1",
        content: { text: "查找 C 盘空间占用来源" },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "msg-asst-1",
        content: { text: "正在分析磁盘配额...", type: "text" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-asst-1",
        content: { text: "已为您定位到占用最多的目录：", type: "text" },
      },
    ];

    const transcript = buildTranscriptFromReplay(replayed);

    expect(transcript.messages.length).toBe(2);
    // User message must NOT be dropped or empty
    expect(transcript.messages[0].role).toBe("user");
    expect(transcript.messages[0].content).toBe("查找 C 盘空间占用来源");

    // Assistant message must have both thought and content
    expect(transcript.messages[1].role).toBe("assistant");
    expect(transcript.messages[1].thought).toBe("正在分析磁盘配额...");
    expect(transcript.messages[1].content).toBe("已为您定位到占用最多的目录：");
  });

  it("aggregates multiple sequential tool calls into the active assistant turn", () => {
    const replayed = [
      {
        sessionUpdate: "user_message_chunk",
        messageId: "u1",
        content: { text: "查看系统进程与磁盘" },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "a1",
        content: { text: "需要运行 powershell 指令" },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Get-PSDrive -Name C",
        kind: "execute",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        status: "completed",
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-2",
        title: "Get-Process | Sort-Object CPU -Descending",
        kind: "execute",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-2",
        status: "completed",
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-3",
        title: "wait",
        kind: "wait",
        status: "completed",
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "a1",
        content: { text: "系统运行平稳，C 盘剩余 32GB。" },
      },
    ];

    const transcript = buildTranscriptFromReplay(replayed);

    // Exactly 2 messages: 1 user, 1 assistant (NOT 5 separate assistant bubbles!)
    expect(transcript.messages.length).toBe(2);

    const asst = transcript.messages[1];
    expect(asst.role).toBe("assistant");
    expect(asst.thought).toBe("需要运行 powershell 指令");
    expect(asst.content).toBe("系统运行平稳，C 盘剩余 32GB。");
    // All 3 tools aggregated in asst.toolCalls
    expect(asst.toolCalls).toBeDefined();
    expect(asst.toolCalls!.length).toBe(3);
    expect(asst.toolCalls![0].id).toBe("tc-1");
    expect(asst.toolCalls![0].status).toBe("completed");
    expect(asst.toolCalls![1].id).toBe("tc-2");
    expect(asst.toolCalls![1].status).toBe("completed");
    expect(asst.toolCalls![2].id).toBe("tc-3");
    expect(asst.toolCalls![2].status).toBe("completed");
  });

  it("extracts session_info_update into session metadata without polluting chat messages", () => {
    const replayed = [
      {
        sessionUpdate: "session_info_update",
        title: "查找 C 盘空间占用来源",
        _meta: { goal: null },
      },
      {
        sessionUpdate: "user_message_chunk",
        messageId: "u1",
        content: { text: "你好" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "a1",
        content: { text: "你好！有什么我可以帮您的吗？" },
      },
      {
        sessionUpdate: "session_info_update",
        title: "查找 C 盘空间占用来源（已更新）",
        _meta: { goal: "完成空间清理" },
      },
    ];

    const transcript = buildTranscriptFromReplay(replayed);

    // Metadata extracted
    expect(transcript.sessionTitle).toBe("查找 C 盘空间占用来源（已更新）");
    expect(transcript.sessionGoal).toBe("完成空间清理");

    // Chat thread must only contain user and assistant messages, ZERO raw json system messages!
    expect(transcript.messages.length).toBe(2);
    expect(transcript.messages.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
    expect(transcript.activities.length).toBe(0);
  });

  it("faithfully parses multi-turn conversations with plans and commands", () => {
    const replayed = [
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "plan", description: "Turn plan mode on" }],
      },
      {
        sessionUpdate: "user_message_chunk",
        messageId: "turn1-u",
        content: { text: "第 1 轮问题" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "turn1-a",
        content: { text: "第 1 轮回答" },
      },
      {
        sessionUpdate: "plan",
        entries: [{ content: "步骤 1", priority: "high", status: "completed" }],
      },
      {
        sessionUpdate: "user_message_chunk",
        messageId: "turn2-u",
        content: { text: "第 2 轮问题" },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "turn2-a",
        content: { text: "思考第 2 轮" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "turn2-a",
        content: { text: "第 2 轮回答" },
      },
      {
        sessionUpdate: "usage_update",
        used: 1200,
        size: 3500,
      },
    ];

    const transcript = buildTranscriptFromReplay(replayed);

    expect(transcript.availableCommands.length).toBe(1);
    expect(transcript.availableCommands[0].name).toBe("plan");
    expect(transcript.plan.length).toBe(1);
    expect(transcript.usage?.used).toBe(1200);

    expect(transcript.messages.length).toBe(4);
    expect(transcript.messages[0].content).toBe("第 1 轮问题");
    expect(transcript.messages[1].content).toBe("第 1 轮回答");
    expect(transcript.messages[2].content).toBe("第 2 轮问题");
    expect(transcript.messages[3].thought).toBe("思考第 2 轮");
    expect(transcript.messages[3].content).toBe("第 2 轮回答");
  });
});
