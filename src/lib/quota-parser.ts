/**
 * Browser-only equivalent of @yitom/acp-client 0.1.6's status parser.
 * Adapted from its MIT-licensed implementation (Yitom); importing the SDK's
 * Node entry here also imports fs/child_process and breaks the renderer build.
 */
import type { parseRateLimitsFromStatusText as sdkParser } from "@yitom/acp-client";

type Snapshot = NonNullable<ReturnType<typeof sdkParser>>;
type Window = NonNullable<Snapshot["primaryWindow"]>;

export function parseRateLimitsFromStatusText(text: string, runtimeId = "unknown"): Snapshot | null {
  if (!text || typeof text !== "string") return null;
  const windows: Window[] = [];
  let account: Snapshot["account"];
  let credits: Snapshot["credits"];
  let status: Snapshot["status"] = "ok";
  let message: string | undefined;
  if (/account (?:disabled|banned|suspended)|suspended|banned/i.test(text)) {
    status = "banned";
    message = "账号已封禁或暂停使用 (Account banned / suspended)";
  } else if (/RESOURCE_EXHAUSTED|quota reached|rate limit exceeded|429/i.test(text)) {
    status = "exhausted";
    message = "额度已用尽 (Quota / Rate limit reached)";
  } else if (/unauthorized|authentication failed|invalid api key/i.test(text)) {
    status = "unauthorized";
    message = "认证失效 (Unauthorized / Invalid credentials)";
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\*\*/g, "").trim();
    if (!line) continue;
    const acc = line.match(/^Account\s*[:：]\s*([^()]+?)(?:\s*\(([^)]+)\))?$/i);
    if (acc) {
      account = { plan: acc[1].trim(), email: acc[2]?.trim() };
      continue;
    }
    const credit = line.match(/(?:\b|^)(?:[\w\s-]*?credits?)\s*[:：]\s*(unlimited|[\d.]+)/i);
    if (credit) {
      const val = credit[1].trim();
      credits = val.toLowerCase() === "unlimited"
        ? { unlimited: true, balance: "unlimited" }
        : { balance: Number(val) || val, unlimited: false };
      continue;
    }
    const win = line.match(/(?:(?:[\w-]+\s+)?([\w\s-]+?(?:limit|spend limit|window)))\s*[:：]\s*(\d+(?:\.\d+)?)%\s*(?:left|remaining)(?:\s*\((?:resets\s*(?:at\s*)?([^)]+)|([^)]+))\))?/i);
    if (win) {
      const label = win[1].trim();
      const pct = parseFloat(win[2]);
      const resetsAt = (win[3] || win[4] || "").trim() || undefined;
      let windowDurationMins: number | undefined;
      if (/5h|5-hour/i.test(label)) windowDurationMins = 300;
      else if (/week/i.test(label)) windowDurationMins = 10080;
      else if (/month/i.test(label)) windowDurationMins = 43200;
      else if (/day|24h/i.test(label)) windowDurationMins = 1440;
      else {
        const hours = label.match(/(\d+)\s*h/i);
        if (hours) windowDurationMins = parseInt(hours[1], 10) * 60;
      }
      windows.push({ label, percentLeft: pct, usedPercent: Math.max(0, 100 - pct), resetsAt, windowDurationMins });
      continue;
    }
    const requests = line.match(/(?:fast requests?|requests?)\s*[:：]\s*(\d+)\s*\/\s*(\d+)/i);
    if (requests) {
      const used = parseInt(requests[1], 10);
      const total = parseInt(requests[2], 10);
      windows.push({
        label: "Fast requests", used, total,
        percentLeft: total > 0 ? Math.round(Math.max(0, total - used) / total * 100) : 0,
        usedPercent: total > 0 ? Math.round(used / total * 100) : 0,
      });
    }
  }
  if (!windows.length && !credits && !account && status === "ok") return null;
  const primary = windows.find((w) => /5h|5-hour|hour|primary|fast/i.test(w.label)) || windows[0];
  const secondary = windows.find((w) => w !== primary && /week|month|secondary/i.test(w.label)) || windows.find((w) => w !== primary);
  const extra = windows.filter((w) => w !== primary && w !== secondary);
  if (primary && primary.percentLeft <= 10 && status === "ok") status = "warning";
  return {
    runtimeId, account, primaryWindow: primary, secondaryWindow: secondary,
    extraWindows: extra.length ? extra : undefined, credits, status, message,
    rawText: text, updatedAt: Date.now(),
  };
}
