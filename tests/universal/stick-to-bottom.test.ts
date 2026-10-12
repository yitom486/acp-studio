import { describe, expect, it } from "vitest";
import { distanceFromBottom, STICK_THRESHOLD_PX } from "../../src/hooks/useStickToBottom";

describe("stick to bottom", () => {
  it("measures distance from bottom and never goes negative", () => {
    expect(distanceFromBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(0);
    expect(distanceFromBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(100);
    expect(distanceFromBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 400 })).toBe(0);
  });
  it("uses an ~80px threshold", () => {
    expect(STICK_THRESHOLD_PX).toBe(80);
  });
});
