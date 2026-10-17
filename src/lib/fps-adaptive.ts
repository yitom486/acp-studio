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
 * 动态计算流式输出最优帧节奏，杜绝高刷屏（180Hz/240Hz）因固定 6ms 时间步长导致的“隔帧跳帧”与微顿挫。
 */
export function getAdaptiveSmoothOptions(fps: number): AdaptiveSmoothOptions {
  const frameTimeMs = 1000 / Math.max(30, fps);

  // 60Hz 屏: 帧间隔 16.6ms，宽裕时间步长
  if (fps <= 75) {
    return {
      drainMs: 200,
      maxCharIntervalMs: 4,
      maxCharsPerFrame: 24,
      minCommitMs: 16,
    };
  }

  // 90Hz~120Hz: 帧间隔 8.3~11.1ms
  if (fps <= 120) {
    return {
      drainMs: 150,
      maxCharIntervalMs: 2.5,
      maxCharsPerFrame: 16,
      minCommitMs: 12,
    };
  }

  // 144Hz~180Hz (电竞/高刷办公屏): 帧间隔 5.5~6.9ms
  // 注意：固定 6ms 在 180Hz (5.5ms) 下会因为 5.5 < 6 导致每隔一帧吐 0 字，造成明显的 90fps 频闪！
  // 必须将 maxCharIntervalMs 下调至 1.5ms 甚至更小，确保每一帧 rAF 均能顺畅推进。
  // minCommitMs 设置为 10ms，保证 React 渲染与 Markdown AST 解析以约 100fps 稳妥提交，避免主线程过载。
  if (fps <= 180) {
    return {
      drainMs: 120,
      maxCharIntervalMs: 1.5,
      maxCharsPerFrame: 12,
      minCommitMs: 10,
    };
  }

  // 240Hz~360Hz 极高刷屏: 帧间隔 2.7~4.1ms
  return {
    drainMs: 90,
    maxCharIntervalMs: 1.0,
    maxCharsPerFrame: 8,
    minCommitMs: 8,
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

