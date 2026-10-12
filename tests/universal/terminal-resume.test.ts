import { describe, it, expect, vi, afterEach } from "vitest";
import * as os from "node:os";
import {
  createPtySession,
  getPtySession,
  destroyPtySession,
  detachPtySession,
  tryResumePtySession,
  attachPtySocket,
  ptyGraceIds,
  PTY_GRACE_MS,
  type PtySpawner,
} from "../../server/universal/pty";

/** 假 pty 工厂（与 terminal-pty.test.ts 同构，kill 即 exit 0）。 */
function fakeSpawner(log: string[]): PtySpawner {
  const child = {
    onData: (_cb: (d: string) => void) => {},
    onExit: (cb: (e: { exitCode: number }) => void) => {
      child.__exitCb = cb;
    },
    write: (data: string) => {
      log.push(`write:${data}`);
    },
    resize: (_cols: number, _rows: number) => {},
    kill: () => {
      if (child.__exited) return;
      child.__exited = true;
      log.push("kill");
      child.__exitCb?.({ exitCode: 0 });
    },
    process: "fake",
    __exited: false,
    __exitCb: null as ((e: { exitCode: number }) => void) | null,
  };
  return ((_shell: string, _args: string[], _opts: Record<string, unknown>) => child) as unknown as PtySpawner;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pty resume (断线保留期）", () => {
  it("exposes a 3-minute grace window", () => {
    expect(PTY_GRACE_MS).toBe(3 * 60 * 1000);
  });

  it("detach keeps the session, resume within grace returns the same shell", () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const id = "resume-keep-1";
    try {
      const s = createPtySession(id, os.tmpdir(), { cols: 80, rows: 24 }, fakeSpawner(log));
      expect(detachPtySession(id)).toBe(true);
      expect(ptyGraceIds()).toContain(id);
      // 保留期内推进一半：还没杀
      vi.advanceTimersByTime(PTY_GRACE_MS / 2);
      expect(getPtySession(id)).toBe(s);
      // 续接：拿回同一个会话，保留期取消
      expect(tryResumePtySession(id)).toBe(s);
      expect(ptyGraceIds()).not.toContain(id);
      // 再推进一整个窗口：续接过的会话不受旧 timer 牵连
      vi.advanceTimersByTime(PTY_GRACE_MS);
      expect(getPtySession(id)).toBe(s);
      expect(log.filter((l) => l === "kill").length).toBe(0);
    } finally {
      destroyPtySession(id);
    }
  });

  it("no resume within grace kills the shell exactly once", () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const id = "resume-expire-1";
    try {
      createPtySession(id, os.tmpdir(), { cols: 80, rows: 24 }, fakeSpawner(log));
      expect(detachPtySession(id)).toBe(true);
      vi.advanceTimersByTime(PTY_GRACE_MS + 1000);
      expect(getPtySession(id)).toBeUndefined();
      expect(ptyGraceIds()).not.toContain(id);
      expect(log.filter((l) => l === "kill").length).toBe(1);
    } finally {
      destroyPtySession(id);
    }
  });

  it("detach on unknown/exited sessions is a no-op; resume gives undefined", () => {
    const log: string[] = [];
    expect(detachPtySession("resume-ghost")).toBe(false);
    expect(tryResumePtySession("resume-ghost")).toBeUndefined();
    const id = "resume-exited-1";
    try {
      const s = createPtySession(id, os.tmpdir(), { cols: 80, rows: 24 }, fakeSpawner(log));
      s.onExit(() => {}); // 生产接线恒注册 onExit（wirePtySocket），退出态靠它置位
      s.kill();
      expect(s.exited).toBe(true);
      expect(detachPtySession(id)).toBe(false);
      expect(tryResumePtySession(id)).toBeUndefined();
    } finally {
      destroyPtySession(id);
    }
  });

  it("destroy cancels a pending grace (no double kill)", () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const id = "resume-destroy-1";
    createPtySession(id, os.tmpdir(), { cols: 80, rows: 24 }, fakeSpawner(log));
    expect(detachPtySession(id)).toBe(true);
    destroyPtySession(id);
    expect(ptyGraceIds()).not.toContain(id);
    vi.advanceTimersByTime(PTY_GRACE_MS + 1000);
    expect(log.filter((l) => l === "kill").length).toBe(1);
  });

  it("takeover closes the old live socket (anti-ghost)", () => {
    const closed: Array<[number | undefined, string | undefined]> = [];
    const w1 = { close: (code?: number, reason?: string) => void closed.push([code, reason]) };
    const w2 = { close: (_code?: number, _reason?: string) => {} };
    const id = "resume-takeover-1";
    const log: string[] = [];
    try {
      createPtySession(id, os.tmpdir(), { cols: 80, rows: 24 }, fakeSpawner(log));
      attachPtySocket(id, w1 as never);
      attachPtySocket(id, w2 as never);
      expect(closed).toEqual([[1000, "superseded"]]);
    } finally {
      destroyPtySession(id);
    }
  });
});
