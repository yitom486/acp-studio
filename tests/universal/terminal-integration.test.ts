import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { TerminalCard } from "@/components/assistant/AcpToolWidgets";
import { applyTerminalCap, TERMINAL_OUTPUT_CAP } from "@/components/universal/TerminalDrawer";
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
});
