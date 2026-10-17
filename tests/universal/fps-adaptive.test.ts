import { describe, it, expect } from "vitest";
import { normalizeFPS, getAdaptiveSmoothOptions } from "../../src/lib/fps-adaptive";

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

  it("calculates adaptive smooth options and minCommitMs throttling per tier", () => {
    // 60Hz: 16.6ms frame time
    const opt60 = getAdaptiveSmoothOptions(60);
    expect(opt60.drainMs).toBe(200);
    expect(opt60.minCommitMs).toBe(16);

    // 120Hz: 8.3ms frame time
    const opt120 = getAdaptiveSmoothOptions(120);
    expect(opt120.drainMs).toBe(150);
    expect(opt120.maxCharIntervalMs).toBe(2.5);
    expect(opt120.minCommitMs).toBe(12);

    // 180Hz (user's monitor): 5.5ms frame time, sub-2ms interval to prevent skipping rAF frames
    const opt180 = getAdaptiveSmoothOptions(180);
    expect(opt180.drainMs).toBe(120);
    expect(opt180.maxCharIntervalMs).toBe(1.5);
    expect(opt180.minCommitMs).toBe(10);

    // 240Hz+ gaming displays: 4.1ms frame time
    const opt240 = getAdaptiveSmoothOptions(240);
    expect(opt240.drainMs).toBe(90);
    expect(opt240.maxCharIntervalMs).toBe(1.0);
    expect(opt240.minCommitMs).toBe(8);
  });
});

