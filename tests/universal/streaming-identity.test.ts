import { describe, it, expect } from "vitest";
import { convertAcpMessage, convertAcpMessages } from "@/lib/acp-assistant";
import { mergeAssistantTurns } from "@/lib/threads";
import type { Message } from "@/lib/message-types";

/**
 * 流式渲染的身份稳定性约束。
 *
 * assistant-ui 的 external store 以「源消息对象引用」作为转换缓存键
 * （ThreadMessageConverter.cache / callbackCache 均为 WeakMap），
 * part 的渲染键则是 `${type}:${id}`，没有 id 时退化为 `${type}@${index}`。
 * 这两条一旦被无关的浅拷贝或 part 增删破坏，就会出现：
 * 整条线程每 token 重新转换 + 正文 part 键漂移 → useSmooth 清空重打（闪烁/跳跃）。
 */
describe("streaming identity stability", () => {
  const user = {
    id: "u1",
    role: "user",
    content: "你好",
    timestamp: "10:00",
  } as unknown as Message;

  const assistant = {
    id: "a1",
    role: "assistant",
    content: "第一段",
    timestamp: "10:01",
    isStreaming: true,
  } as unknown as Message;

  it("reuses the converted message for untouched sources", () => {
    const first = convertAcpMessages([user, assistant]);
    // 模拟流式分片：只有助手消息被替换成新对象
    const grown = { ...assistant, content: "第一段，第二段" } as unknown as Message;
    const second = convertAcpMessages([user, grown]);

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect((second[1].content as Array<{ type: string; text?: string }>)[0].text).toContain("第二段");
  });

  it("keeps a stable text part id even when tool calls shift its position", () => {
    const withTool = {
      ...assistant,
      toolCalls: [{ id: "t1", title: "read a.ts", kind: "file", status: "completed" }],
    } as unknown as Message;

    const plainParts = convertAcpMessage(assistant).content as any[];
    const toolParts = convertAcpMessage(withTool).content as any[];

    const plainText = plainParts.find((p) => p.type === "text");
    const toolText = toolParts.find((p) => p.type === "text");

    expect(plainText.id).toBe("body-0");
    expect(toolText.id).toBe("body-0");
    // 位置被工具调用挤到后面，但渲染键（id）没有漂移
    expect(plainParts.indexOf(plainText)).toBe(0);
    expect(toolParts.indexOf(toolText)).toBe(1);
  });

  it("gives the reasoning part a stable id too", () => {
    const withThought = { ...assistant, thought: "想一想" } as unknown as Message;
    const parts = convertAcpMessage(withThought).content as any[];
    const reasoning = parts.find((p) => p.type === "reasoning");
    expect(reasoning?.id).toBe("thought");
  });

  it("mergeAssistantTurns preserves identity for untouched and no-op merges", () => {
    const base = { id: "a1", role: "assistant", content: "答", isStreaming: false } as unknown as Message;

    const kept = mergeAssistantTurns([user, base]);
    expect(kept[0]).toBe(user);
    expect(kept[1]).toBe(base);

    // 空续传（无正文/思考/工具）不应产出新对象
    const empty = { id: "a2", role: "assistant", content: "", isStreaming: false } as unknown as Message;
    const noop = mergeAssistantTurns([user, base, empty]);
    expect(noop.length).toBe(2);
    expect(noop[1]).toBe(base);

    // 真正有新内容时才产出新对象
    const more = { id: "a3", role: "assistant", content: "续", isStreaming: false } as unknown as Message;
    const grown = mergeAssistantTurns([user, base, more]);
    expect(grown[1]).not.toBe(base);
    expect(grown[1].content).toContain("续");
  });

  it("mergeAssistantTurns keeps the toolCalls array identity when the update is a no-op", () => {
    const tool = { id: "t1", title: "read", status: "completed" as const };
    const withTool = {
      id: "a4",
      role: "assistant",
      content: "答",
      toolCalls: [tool],
      isStreaming: false,
    } as unknown as Message;

    const same = {
      id: "a5",
      role: "assistant",
      content: "",
      toolCalls: [{ ...tool }],
      isStreaming: false,
    } as unknown as Message;

    const merged = mergeAssistantTurns([withTool, same]);
    expect(merged.length).toBe(1);
    expect(merged[0]).toBe(withTool);
    expect(merged[0].toolCalls).toBe(withTool.toolCalls);
  });
});
