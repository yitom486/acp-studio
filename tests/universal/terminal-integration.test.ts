import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { TerminalCard } from "@/components/assistant/AcpToolWidgets";
import { applyTerminalCap, TERMINAL_OUTPUT_CAP, defaultTerminalGeom, clampTerminalGeom, moveTerminalGeom, resizeTerminalGeom, buildXtermTheme, readTerminalCssVars, isLightTerminalTheme, buildTerminalExportFilename } from "@/components/universal/TerminalDrawer";
import { useStudioStore } from "@/stores/useStudioStore";

describe("terminal integration (P0/P1)", () => {
  it("TerminalCard offers open-in-terminal that only prefills (never executes)", async () => {
    useStudioStore.setState({ terminalOpen: false, terminalPrefill: null } as any);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(TerminalCard, {
          tc: {
            id: "t1",
            title: "npm install",
            kind: "terminal",
            status: "completed",
            rawInput: { command: "npm install" },
          } as any,
        })
      );
    });
    const btn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("终端打开")
    );
    expect(btn).toBeTruthy();
    await act(async () => {
      (btn as HTMLElement).click();
    });
    const st = useStudioStore.getState();
    // 只预填 + 弹起抽屉：执行仍需用户在终端按回车
    expect(st.terminalPrefill).toBe("npm install");
    expect(st.terminalOpen).toBe(true);
    root.unmount();
    el.remove();
    useStudioStore.setState({ terminalOpen: false, terminalPrefill: null } as any);
  });

  it("hides the open-in-terminal entry when no command is present", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        h(TerminalCard, { tc: { id: "t2", title: "", kind: "terminal", status: "completed" } as any })
      );
    });
    expect(
      Array.from(el.querySelectorAll("button")).some((b) => b.textContent?.includes("终端打开"))
    ).toBe(false);
    root.unmount();
    el.remove();
  });

  it("caps terminal output at 128KB", () => {
    expect(applyTerminalCap(0, "hi")).toEqual({ write: "hi", capped: false });
    const big = "x".repeat(TERMINAL_OUTPUT_CAP + 100);
    const r = applyTerminalCap(0, big);
    expect(r.write.length).toBe(TERMINAL_OUTPUT_CAP);
    expect(r.capped).toBe(true);
    expect(applyTerminalCap(TERMINAL_OUTPUT_CAP, "more")).toEqual({ write: "", capped: true });
    const edge = applyTerminalCap(TERMINAL_OUTPUT_CAP - 2, "abcd");
    expect(edge).toEqual({ write: "ab", capped: true });
  });

  it("defaults the floating panel to bottom-right without covering the chat", () => {
    const g = defaultTerminalGeom(1600, 900);
    expect(g.w).toBe(720);
    expect(g.h).toBe(340);
    expect(g.x).toBe(1600 - 720 - 16);
    expect(g.y).toBe(900 - 340 - 16);
  });

  it("clamps geometry into the viewport and minimum size", () => {
    const g = clampTerminalGeom({ x: -5000, y: -5000, w: 50, h: 50 }, 1600, 900);
    expect(g.w).toBe(380);
    expect(g.h).toBe(200);
    expect(g.x).toBeGreaterThanOrEqual(8 - g.w + 120);
    expect(g.y).toBeGreaterThanOrEqual(8);
    const big = clampTerminalGeom({ x: 0, y: 0, w: 5000, h: 5000 }, 1600, 900);
    expect(big.w).toBe(1600 - 16);
    expect(big.h).toBe(900 - 16);
  });

  it("moves and resizes with edge fixing at minimum size", () => {
    const g = { x: 100, y: 100, w: 500, h: 300 };
    expect(moveTerminalGeom(g, 20, -30, 1600, 900)).toMatchObject({ x: 120, y: 70, w: 500, h: 300 });
    // 东边拉宽 / 南边拉高
    expect(resizeTerminalGeom(g, "se", 40, 50, 1600, 900)).toMatchObject({ w: 540, h: 350 });
    // 西边右拉：x 前进、宽收缩
    expect(resizeTerminalGeom(g, "w", 60, 0, 1600, 900)).toMatchObject({ x: 160, w: 440 });
    // 西边压到最小宽：对侧边（右）固定，x 回退
    const squeezed = resizeTerminalGeom(g, "w", 400, 0, 1600, 900);
    expect(squeezed.w).toBe(380);
    expect(squeezed.x).toBe(100 + 500 - 380);
    // 北边下拉：y 前进、高收缩
    expect(resizeTerminalGeom(g, "n", 0, 40, 1600, 900)).toMatchObject({ y: 140, h: 260 });
  });

  it("builds a theme-aware xterm palette (no more hardcoded black)", () => {
    const vars = { background: "#fff", card: "#ffffff", cardForeground: "#111", primary: "#257" };
    const dark = buildXtermTheme(vars, false);
    expect(dark.background).toBe("#ffffff");
    expect(dark.foreground).toBe("#111");
    expect(dark.cursor).toBe("#257");
    expect(dark.white).toBe("#fafafa");
    const light = buildXtermTheme(vars, true);
    // 浅色下 black/white 对调，否则白底看不见字
    expect(light.black).toBe("#737373");
    expect(light.white).toBe("#262626");
    expect(light.red).toBe("#dc2626");
  });

  it("falls back to dark defaults when CSS vars are unavailable", () => {
    const vars = readTerminalCssVars();
    expect(vars.card).toBeTruthy();
    expect(isLightTerminalTheme()).toBe(false);
  });

  it("builds export filenames from workspace short name", () => {
    expect(buildTerminalExportFilename("D:/project/js/Electron/antigravity-acp", 1234567890)).toBe(
      "terminal-antigravity-acp-1234567890.log"
    );
    expect(buildTerminalExportFilename("", 1)).toBe("terminal-terminal-1.log");
  });
});
