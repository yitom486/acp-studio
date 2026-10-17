import { describe, it, expect } from "vitest";
import {
  normalizeFPS,
  getAdaptiveSmoothOptions,
  type AdaptiveSmoothOptions,
} from "../../src/lib/fps-adaptive";

/** 复刻 useSmooth 的速率公式：baseTimePerChar = min(interval, drain / remaining)。 */
function revealCharsPerSecond(fps: number, opt: AdaptiveSmoothOptions, remaining: number) {
  const base = Math.min(opt.maxCharIntervalMs ?? Infinity, opt.drainMs / Math.max(1, remaining));
  const byTime = 1000 / base;
  const byFrameCap = (opt.maxCharsPerFrame ?? Infinity) * fps;
  return Math.min(byTime, byFrameCap);
}

const TIERS = [60, 90, 120, 144, 165, 180, 240, 300, 360];

describe("fps-adaptive", () => {
  it("normalizes arbitrary raw frame rates to standard hardware tiers", () => {
    expect(normalizeFPS(59.94)).toBe(60);
    expect(normalizeFPS(60.1)).toBe(60);
    expect(normalizeFPS(119.8)).toBe(120);
    expect(normalizeFPS(143.9)).toBe(144);
    expect(normalizeFPS(179.5)).toBe(180);
    expect(normalizeFPS(239.9)).toBe(240);
    expect(normalizeFPS(359.8)).toBe(360);
    expect(normalizeFPS(-5)).toBe(60);
    expect(normalizeFPS(NaN)).toBe(60);
  });

  it("keeps one typing cadence across every refresh rate", () => {
    // 逐字节奏必须与刷新率解耦：历史实现把 interval 压到 1~4ms，
    // 导致每帧吐 4~24 个字，正文变成“整词/整行蹦出”。
    for (const fps of TIERS) {
      expect(getAdaptiveSmoothOptions(fps).maxCharIntervalMs).toBe(14);
    }
  });

  it("reveals at a character-granular, display-independent rate in steady state", () => {
    for (const fps of TIERS) {
      const opt = getAdaptiveSmoothOptions(fps);
      // 稳态积压 60 字：约 50~160 字/秒，既不是龟速也不是整行蹦出
      const rate = revealCharsPerSecond(fps, opt, 60);
      expect(rate).toBeGreaterThan(50);
      expect(rate).toBeLessThan(160);
      // 任何刷新率下都不能停滞（0 字/秒）
      expect(rate).toBeGreaterThan(0);
    }
  });

  it("catches up quickly when a large chunk arrives at once", () => {
    for (const fps of [60, 120, 240]) {
      const opt = getAdaptiveSmoothOptions(fps);
      // 4000 字积压必须在数秒内追平（60Hz 下约 1.4k 字/秒），不能越落越远
      expect(revealCharsPerSecond(fps, opt, 4000)).toBeGreaterThan(1000);
    }
  });

  it("keeps the AST commit budget in a sane window", () => {
    for (const fps of TIERS) {
      const opt = getAdaptiveSmoothOptions(fps);
      // 下限：不允许每帧都提交（否则长文本会陷入 Markdown 反复解析）
      expect(opt.minCommitMs).toBeGreaterThanOrEqual(4);
      // 上限：也不能攒太久，否则正文会变成一次蹦 3 个字以上
      expect(opt.minCommitMs).toBeLessThanOrEqual(32);
    }
  });
});
