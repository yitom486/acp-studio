// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { parseRateLimitsFromStatusText as original } from "@yitom/acp-client";
import { parseRateLimitsFromStatusText } from "../../src/lib/quota-parser";

afterEach(() => vi.restoreAllMocks());

it.each([
  "**Account: Pro (test@example.com)**\n5-hour limit: 90% left (resets at 18:00)\nWeekly limit: 60% remaining",
  "Primary window: 5% remaining\nMonthly spend limit: 50% left\nDaily limit: 70% left\nCredits: 12.5",
  "Fast requests: 8 / 20\nCredits: unlimited",
  "RESOURCE_EXHAUSTED: quota reached",
  "Account suspended",
  "Unauthorized: invalid API key",
  "ordinary assistant answer",
  "",
])("preserves the SDK's quota parsing without importing its Node implementation into the renderer: %s", (text) => {
  vi.spyOn(Date, "now").mockReturnValue(123456789);
  expect(parseRateLimitsFromStatusText(text, "codex")).toEqual(original(text, "codex"));
});
