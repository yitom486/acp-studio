import { useEffect, useState } from "react";

const STANDARD_FPS_TIERS = [30, 60, 75, 90, 120, 144, 165, 180, 240, 300, 360];

let cachedFps: number | null = null;
let detectingPromise: Promise<number> | null = null;

/**
 * 快速检测当前屏幕真实刷新率 (返回如 60, 90, 120, 144, 165, 180, 240, 300 等)。
 * 采样 20~25 帧（耗时仅 100~150ms），就近吸附到工业标准硬件档位。
 */
export function detectDeviceFPS(sampleFrames = 25): Promise<number> {
  if (cachedFps) return Promise.resolve(cachedFps);
  if (detectingPromise) return detectingPromise;

  if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") {
    return Promise.resolve(60);
  }

  detectingPromise = new Promise<number>((resolve) => {
    let frameCount = 0;
    let startTime = 0;

    function count(timestamp: number) {
      if (!startTime) {
        startTime = timestamp;
      } else {
        frameCount++;
      }

      if (frameCount >= sampleFrames) {
        const duration = timestamp - startTime;
        const avgFrameTime = duration / Math.max(1, frameCount);
        const rawFps = 1000 / Math.max(1, avgFrameTime);
        const normalized = normalizeFPS(rawFps);
        cachedFps = normalized;
        detectingPromise = null;
        resolve(normalized);
        return;
      }

      requestAnimationFrame(count);
    }

    requestAnimationFrame(count);
  });

  return detectingPromise;
}

/**
 * 消除高精浮点抖动，就近映射到真实物理硬件标准档位
 */
export function normalizeFPS(rawFps: number): number {
  if (!Number.isFinite(rawFps) || rawFps <= 0) return 60;
  let closest = 60;
  let minDiff = Infinity;

  for (const tier of STANDARD_FPS_TIERS) {
    const diff = Math.abs(rawFps - tier);
    if (diff < minDiff) {
      minDiff = diff;
      closest = tier;
    }
  }
  return closest;
}

export interface AdaptiveSmoothOptions {
  drainMs: number;
  maxCharIntervalMs: number;
  maxCharsPerFrame?: number;
  /**
   * 提交更新最小间隔 (ms)。动画逐帧 (rAF) 连续推进，但将 Markdown AST 重新解析与
   * React 组件树重渲染的提交频率节流在安全阈值，彻底解决 180Hz/240Hz 屏因高频 AST 重算引发的 CPU 抖动与表格高度跳跃。
   */
  minCommitMs?: number;
}

/**
 * 根据物理屏幕刷新率（60Hz、120Hz、144Hz、180Hz、240Hz、300Hz+）
 * 计算流式输出的揭示节奏。
 *
 * 关键：揭示速度要与刷新率**解耦**。`useSmooth` 的速率公式是
 * `baseTimePerChar = min(maxCharIntervalMs, drainMs / remainingChars)`，
 * 一旦 `maxCharIntervalMs` 被压到亚毫秒级（历史实现是 1~4ms），
 * 每一帧就会一次吐出 4~24 个字——正文不是“逐字打出来”，而是“整词/整行蹦出来”，
 * 这正是气泡拉长显得生硬、跳变的直接原因。
 *
 * 现在的策略：
 * - `maxCharIntervalMs` 固定 14ms ≈ 70 字/秒，任何刷新率下都是逐字推进
 *   （高刷屏上会有若干帧不吐字，那是 14ms 的文字更新节奏，肉眼不可见）；
 * - `drainMs` 负责“追平”：积压越多单字耗时越短，最多可到 `maxCharsPerFrame`
 *   字/帧，保证大分片一次性到达时仍能在 1 秒内追平，不会越落越远；
 * - `minCommitMs` 只限制「Markdown AST 重新解析 + React 提交」的频率，按帧时间给，
 *   保证每帧最多提交一次。
 */
export function getAdaptiveSmoothOptions(fps: number): AdaptiveSmoothOptions {
  const frameTimeMs = 1000 / Math.max(30, fps);

  // 恒定打字节奏（≈70 字/秒），不随刷新率变化。
  const TYPING_INTERVAL_MS = 14;
  // 追平窗口内的单帧上限：仅用于超大分片兜底，正常输出远达不到。
  const MAX_CHARS_PER_FRAME = 24;

  // 60Hz 屏: 帧间隔 16.6ms
  if (fps <= 75) {
    return {
      drainMs: 900,
      maxCharIntervalMs: TYPING_INTERVAL_MS,
      maxCharsPerFrame: MAX_CHARS_PER_FRAME,
      minCommitMs: 16,
    };
  }

  // 90Hz~120Hz: 帧间隔 8.3~11.1ms
  if (fps <= 120) {
    return {
      drainMs: 800,
      maxCharIntervalMs: TYPING_INTERVAL_MS,
      maxCharsPerFrame: MAX_CHARS_PER_FRAME,
      minCommitMs: Math.max(8, Math.round(frameTimeMs)),
    };
  }

  // 144Hz~180Hz (电竞/高刷办公屏): 帧间隔 5.5~6.9ms
  if (fps <= 180) {
    return {
      drainMs: 700,
      maxCharIntervalMs: TYPING_INTERVAL_MS,
      maxCharsPerFrame: MAX_CHARS_PER_FRAME,
      minCommitMs: Math.max(6, Math.round(frameTimeMs)),
    };
  }

  // 240Hz~360Hz 极高刷屏: 帧间隔 2.7~4.1ms
  return {
    drainMs: 600,
    maxCharIntervalMs: TYPING_INTERVAL_MS,
    maxCharsPerFrame: MAX_CHARS_PER_FRAME,
    minCommitMs: Math.max(4, Math.round(frameTimeMs)),
  };
}

/**
 * 自适应屏幕帧率 Hook，自动测量并缓存刷新率与平滑输出参数
 */
export function useDeviceFps(): { fps: number; smoothOptions: AdaptiveSmoothOptions } {
  const [fps, setFps] = useState<number>(() => cachedFps ?? 60);

  useEffect(() => {
    let active = true;
    void detectDeviceFPS().then((detected) => {
      if (active) setFps(detected);
    });
    return () => {
      active = false;
    };
  }, []);

  return {
    fps,
    smoothOptions: getAdaptiveSmoothOptions(fps),
  };
}

