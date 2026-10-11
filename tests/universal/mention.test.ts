import { describe, it, expect } from "vitest";
import {
  matchMentionToken,
  applyMentionInsert,
  buildMentionAttachment,
  formatFileSize,
} from "@/lib/mention";

describe("@-mention helpers", () => {
  it("detects only the trailing @-token", () => {
    expect(matchMentionToken("看看 @a.t")).toBe("@a.t");
    expect(matchMentionToken("@")).toBe("@");
    expect(matchMentionToken("看看 @src/复件 x")).toBeNull();
    expect(matchMentionToken("邮箱 a@b.com 末尾")).toBeNull();
    expect(matchMentionToken("hi")).toBeNull();
  });

  it("replaces the trailing token with display name + space", () => {
    expect(applyMentionInsert("看看 @a", "src/a.ts")).toBe("看看 @src/a.ts ");
    expect(applyMentionInsert("@a", "b")).toBe("@b ");
  });

  it("builds resource attachments with truncation note", () => {
    const a = buildMentionAttachment({
      repo: "/r", file: "src/a.ts", mimeType: "text/plain", size: 10, text: "hi", truncated: false,
    });
    expect(a.name).toBe("src/a.ts");
    expect(a.block).toMatchObject({
      type: "resource",
      resource: { uri: "file:///src/a.ts", text: "hi" },
    });
    const t = buildMentionAttachment({
      repo: "/r", file: "big.txt", mimeType: "text/plain", size: 70000, text: "x", truncated: true,
    });
    expect(String((t.block as any).resource.text)).toContain("truncated");
  });

  it("formats file sizes", () => {
    expect(formatFileSize(500)).toBe("500B");
    expect(formatFileSize(2048)).toBe("2.0KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0MB");
  });
});
