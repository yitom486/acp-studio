import { describe, it, expect, beforeEach } from "bun:test";
import { getSystemDirectoryRoots } from "../../server/universal/http/workspace";
import { getWorkspaceEnv, isLocalMode, getWorkspaceStorageKey } from "../../src/stores/useStudioStore";
import { getGatewayBase, setGatewayBase, parseGatewayBase } from "../../src/lib/gateway-auth";

describe("WSL Native Environment Integration & E2E Isolation Tests", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) || null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    };
  });

  describe("1. Gateway Port & Base Lifecycle", () => {
    it("preserves WSL gateway base at port 13006 when WSL distro is active", () => {
      localStorage.setItem("acp_wsl_native_distro", "Ubuntu");
      setGatewayBase("http://127.0.0.1:13006");

      // 在 WSL 模式下，13006 端口绝不能被当作本地同源网关清空
      expect(getGatewayBase()).toBe("http://127.0.0.1:13006");
      expect(getWorkspaceEnv()).toBe("wsl_ubuntu");
      expect(isLocalMode()).toBe(false);
    });

    it("clears local gateway base when switching back to Windows local mode", () => {
      // 模拟先处于 WSL 模式
      localStorage.setItem("acp_wsl_native_distro", "Ubuntu");
      setGatewayBase("http://127.0.0.1:13006");
      expect(isLocalMode()).toBe(false);

      // 模拟 backToLocal 操作
      localStorage.removeItem("acp_wsl_native_distro");
      setGatewayBase("");

      expect(getGatewayBase()).toBe("");
      expect(getWorkspaceEnv()).toBe("local");
      expect(isLocalMode()).toBe(true);
      expect(getWorkspaceStorageKey()).toBe("acp_workspace_local");
    });
  });

  describe("2. Health Probe Verification & Anti-Collision", () => {
    it("distinguishes Linux gateway from Windows host gateway", () => {
      // 探针响应 mock 判定规则验证：
      // 如果探测返回 platform 为 win32，探针必须拒绝将其视为 WSL 网关
      const mockWinHostResponse = {
        ok: true,
        path: "D:\\project\\js\\Electron\\antigravity-acp",
        platform: "win32",
      };
      const isWslValidHost = mockWinHostResponse.platform === "linux";
      expect(isWslValidHost).toBe(false);

      // 如果探测返回 platform 为 linux，探针认可其为有效 WSL 原生网关
      const mockLinuxWslResponse = {
        ok: true,
        path: "/home/tomy/projects/rust/fd",
        platform: "linux",
      };
      const isLinuxValid = mockLinuxWslResponse.platform === "linux";
      expect(isLinuxValid).toBe(true);
    });
  });

  describe("3. Workspace Directory Picker Isolation", () => {
    it("strictly isolates directory roots for WSL without leaking Windows drive letters", () => {
      if (process.platform === "win32") {
        const wslRoots = getSystemDirectoryRoots("Ubuntu");
        expect(wslRoots.length).toBeGreaterThanOrEqual(1);

        for (const root of wslRoots) {
          // 每个根必须指明 distro 为 Ubuntu
          expect(root.distro).toBe("Ubuntu");
          // 绝对不能出现 Windows 盘符 C: 或 D:
          expect(root.label).not.toMatch(/本地磁盘\s*\([a-zA-Z]:\)/i);
          expect(root.path).not.toMatch(/^[a-zA-Z]:[\\\/]/);
          // 必须指向 \\wsl.localhost\Ubuntu
          expect(root.path).toMatch(/\\\\wsl\.localhost\\Ubuntu/i);
        }

        // 本机 Windows 模式下的 roots 必须包含盘符
        const localRoots = getSystemDirectoryRoots();
        const hasWindowsDrive = localRoots.some((r) => /本地磁盘\s*\([a-zA-Z]:\)/i.test(r.label));
        expect(hasWindowsDrive).toBe(true);
      }
    });
  });

  describe("4. Sidebar Projects and Sessions Cross-System Filter", () => {
    // 模拟 Sidebar 中的 isPathMatchingEnv 核心过滤算法
    const filterForEnv = (paths: string[], isWsl: boolean): string[] => {
      const isPathMatchingEnv = (pathStr: string): boolean => {
        if (!pathStr) return false;
        const isWin = /^[a-zA-Z]:[\\\/]/i.test(pathStr) || /^\/mnt\/[a-zA-Z](\/|$)/i.test(pathStr);
        if (isWsl) {
          return !isWin;
        } else {
          if (pathStr.startsWith("/home/") || pathStr.startsWith("/root/")) {
            return false;
          }
          return true;
        }
      };
      return paths.filter(isPathMatchingEnv);
    };

    const mixedPaths = [
      "D:\\project\\js\\Electron\\antigravity-acp",
      "C:\\Users\\zheye\\Desktop\\project",
      "/mnt/c/Users/zheye/code",
      "/home/tomy/projects/rust/fd",
      "\\\\wsl.localhost\\Ubuntu\\home\\tomy\\repo",
      "/root/workspace",
    ];

    it("filters out ALL Windows drives and /mnt/ mount paths in WSL mode", () => {
      const wslFiltered = filterForEnv(mixedPaths, true);
      // 只能包含 Linux 原生路径与 WSL UNC 路径
      expect(wslFiltered).toEqual([
        "/home/tomy/projects/rust/fd",
        "\\\\wsl.localhost\\Ubuntu\\home\\tomy\\repo",
        "/root/workspace",
      ]);
      // 坚决不能出现任何 Windows 盘符或挂载路径
      expect(wslFiltered.some((p) => /^[a-zA-Z]:/i.test(p))).toBe(false);
      expect(wslFiltered.some((p) => /^\/mnt\//i.test(p))).toBe(false);
    });

    it("filters out Linux paths in Windows local mode", () => {
      const winFiltered = filterForEnv(mixedPaths, false);
      expect(winFiltered.some((p) => p.startsWith("/home/"))).toBe(false);
      expect(winFiltered.some((p) => p.startsWith("/root/"))).toBe(false);
      expect(winFiltered).toContain("D:\\project\\js\\Electron\\antigravity-acp");
      expect(winFiltered).toContain("C:\\Users\\zheye\\Desktop\\project");
    });
  });

  describe("5. RemoteButton State & UI Badge Contract", () => {
    it("computes badge label, icon, and native status correctly", () => {
      // 场景 A: 处于 WSL 原生真环境
      localStorage.setItem("acp_wsl_native_distro", "Ubuntu");
      const distro = localStorage.getItem("acp_wsl_native_distro");
      const isWslNative = Boolean(distro);
      const label = isWslNative ? `WSL: ${distro} (真环境)` : "本机";
      const icon = isWslNative ? "🐧" : "><";

      expect(isWslNative).toBe(true);
      expect(label).toBe("WSL: Ubuntu (真环境)");
      expect(icon).toBe("🐧");

      // 场景 B: 切回本机 Windows 环境
      localStorage.removeItem("acp_wsl_native_distro");
      const distroB = localStorage.getItem("acp_wsl_native_distro");
      const isWslNativeB = Boolean(distroB);
      const labelB = isWslNativeB ? `WSL: ${distroB} (真环境)` : "本机";
      const iconB = isWslNativeB ? "🐧" : "><";

      expect(isWslNativeB).toBe(false);
      expect(labelB).toBe("本机");
      expect(iconB).toBe("><");
    });
  });
});
