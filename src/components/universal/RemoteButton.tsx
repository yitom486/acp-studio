import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, FolderOpen, Loader2, Monitor, Play, Server, Terminal } from "lucide-react";
import { useStudioStore } from "@/stores/useStudioStore";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { getGatewayBase, setGatewayBase, setGatewayToken, gatewayHost } from "@/lib/gateway-auth";
import { listWslDistros, launchWslGateway, DEFAULT_WSL_GATEWAY_PORT } from "@/lib/universal-api";
import { parseWslDistro } from "@/lib/wsl-distro";
import { runCommand } from "@/lib/commands";
import { cn } from "@/lib/utils";

const menuCls =
  "absolute bottom-6 left-1 z-50 min-w-72 max-w-88 rounded-xl border border-border bg-popover p-1.5 text-xs text-popover-foreground shadow-2xl backdrop-blur-md";

const rowCls =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors";

export const RemoteButton: React.FC = () => {
  const currentWorkspace = useStudioStore((s) => s.currentWorkspace);
  const recentWorkspaces = useStudioStore((s) => s.recentWorkspaces);
  const openSettings = useWorkbenchStore((s) => s.openSettings);
  const openWorkspacePicker = useWorkbenchStore((s) => s.openWorkspacePicker);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectingDistro, setConnectingDistro] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const base = getGatewayBase();
  const distro = currentWorkspace ? parseWslDistro(currentWorkspace) : null;

  // 记录是否处于 WSL 原生真环境中 (存储在 localStorage)
  const wslNativeDistro = typeof localStorage !== "undefined" ? localStorage.getItem("acp_wsl_native_distro") : null;
  const isWslNative = Boolean(wslNativeDistro);

  const distrosQuery = useQuery({
    queryKey: ["universal", "wsl-distros"],
    queryFn: listWslDistros,
    enabled: menuOpen,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const distros = distrosQuery.data ?? [];
  const showWsl = distro || distros.length > 0 || distrosQuery.isPending || distrosQuery.isError;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const close = () => {
    setMenuOpen(false);
    setConnectError(null);
  };

  const openWslFolder = (d: string) => {
    close();
    openWorkspacePicker({ distro: d });
  };

  // 一键启动并在 WSL 内直连原生网关
  const handleConnectWslNative = async (d: string) => {
    setConnectingDistro(d);
    setConnectError(null);
    try {
      const res = await launchWslGateway(d, DEFAULT_WSL_GATEWAY_PORT);
      if (res.ok && res.url) {
        localStorage.setItem("acp_wsl_native_distro", d);
        // 清理 WSL 环境存储中任何遗留的 Windows 挂载 /mnt/ 路径，确保进入纯 Linux 原生工作区
        const wslKey = `acp_workspace_wsl_${d.trim().toLowerCase()}`;
        const savedWslCurrent = localStorage.getItem(`${wslKey}_current`);
        if (savedWslCurrent && (/^\/mnt\/[a-zA-Z](\/|$)/i.test(savedWslCurrent) || /^[a-zA-Z]:[\\\/]/i.test(savedWslCurrent))) {
          localStorage.removeItem(`${wslKey}_current`);
        }
        setGatewayBase(res.url);
        if (res.token) {
          setGatewayToken(res.token, true);
        }
        close();
        window.location.reload();
      } else {
        setConnectError(res.error || "启动 WSL 原生网关失败");
      }
    } catch (err: any) {
      setConnectError(err?.message || "请求启动 WSL 网关失败");
    } finally {
      setConnectingDistro(null);
    }
  };

  const backToLocal = () => {
    localStorage.removeItem("acp_wsl_native_distro");
    setGatewayBase("");
    close();
    window.location.reload();
  };

  const label = isWslNative
    ? `WSL: ${wslNativeDistro} (真环境)`
    : base
      ? `远端 ${gatewayHost(base)}`
      : distro
        ? `WSL: ${distro}`
        : "本机";

  const title = isWslNative
    ? `已连接 WSL ${wslNativeDistro} 原生 Linux 开发环境（点此切换）`
    : base
      ? `经远端网关 ${base} 连接（点此切换）`
      : distro
        ? `WSL 发行版 ${distro}（点此切换）`
        : "本地网关 + 本地工作区（点此切换）";

  return (
    <div ref={rootRef} className="relative flex h-full items-stretch">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title={title}
        aria-label={`当前环境：${label}（点击切换）`}
        aria-expanded={menuOpen}
        className={cn(
          "flex items-center gap-1.5 px-2.5 font-mono text-[11px] transition-colors",
          isWslNative
            ? "bg-emerald-600 text-white hover:bg-emerald-500 font-semibold"
            : base || distro
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <span aria-hidden>{isWslNative ? "🐧" : "><"}</span>
        <span className="max-w-48 truncate">{label}</span>
      </button>
      {menuOpen && (
        <div className={menuCls} role="menu" aria-label="切换环境">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            当前：{label}
          </div>

          <button
            type="button"
            role="menuitem"
            className={rowCls}
            onClick={() => (base || isWslNative ? backToLocal() : close())}
          >
            <Monitor className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">本机 Windows 环境</span>
            {!base && !distro && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>

          {showWsl && (
            <>
              <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                WSL 发行版与真环境
              </div>
              {distrosQuery.isPending && (
                <div className="px-2 py-1.5 text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>正在扫描 WSL 发行版…</span>
                </div>
              )}
              {distrosQuery.isError && (
                <div className="px-2 py-1.5 text-destructive break-words" title="点远端网关…可连 WSL 里的网关">
                  {String((distrosQuery.error as Error)?.message || "读取失败")}
                </div>
              )}
              {connectError && (
                <div className="mx-1 my-1 rounded bg-destructive/15 p-2 text-[11px] text-destructive break-words">
                  {connectError}
                </div>
              )}
              {distrosQuery.isSuccess && distros.length === 0 && !distro && (
                <div className="px-2 py-1.5 text-muted-foreground break-words">
                  已连通但无发行版：在 PowerShell 跑 wsl --install -d Ubuntu
                </div>
              )}
              {distros.map((d) => {
                const isCurrentNative = isWslNative && wslNativeDistro?.toLowerCase() === d.toLowerCase();
                const isConnecting = connectingDistro === d;
                return (
                  <div key={d} className="my-0.5 rounded-md border border-border/40 p-1 bg-background/30">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 truncate flex-1 px-1">
                        <Terminal className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="font-semibold text-xs truncate">WSL: {d}</span>
                        {isCurrentNative && (
                          <span className="rounded-sm bg-emerald-500/15 px-1 py-0.2 text-[9.5px] font-mono text-emerald-500 font-medium">
                            原生已连
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          role="menuitem"
                          aria-label={`一键连接真环境 WSL: ${d}`}
                          disabled={isConnecting}
                          onClick={() => handleConnectWslNative(d)}
                          title="一键打通真环境：在 WSL 内部启动网关，所有 Agent 与终端作为 Linux 原生进程就地运行"
                          className={cn(
                            "flex items-center gap-1 rounded-sm px-2 py-1 font-mono text-[10.5px] font-medium transition-colors border shadow-xs",
                            isCurrentNative
                              ? "bg-emerald-600 text-white border-emerald-500"
                              : "bg-primary text-primary-foreground hover:bg-primary/90 border-primary/20"
                          )}
                        >
                          {isConnecting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-2.5 w-2.5 fill-current" />
                          )}
                          <span>{isCurrentNative ? "已直连" : "一键打通真环境"}</span>
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          aria-label={`选择工作区目录 WSL: ${d}`}
                          onClick={() => openWslFolder(d)}
                          title="打开内置工作区选择器浏览目录"
                          className="rounded-sm border border-border p-1 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <FolderOpen className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {recentWorkspaces
                      .filter((r) => parseWslDistro(r.path)?.toLowerCase() === d.toLowerCase())
                      .slice(0, 3)
                      .map((r) => (
                        <button
                          key={r.path}
                          type="button"
                          role="menuitem"
                          className={cn(rowCls, "pl-6 py-1 text-[11px]")}
                          title={r.path}
                          onClick={() => {
                            close();
                            void runCommand("workspace.open", r.path);
                          }}
                        >
                          <span className="flex-1 truncate">{r.name}</span>
                          {currentWorkspace === r.path && <Check className="h-3 w-3 shrink-0" />}
                        </button>
                      ))}
                  </div>
                );
              })}
            </>
          )}

          <div className="my-1.5 h-px bg-border/60" />

          <button
            type="button"
            role="menuitem"
            className={rowCls}
            onClick={() => {
              close();
              openSettings("gateway");
            }}
          >
            <Server className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">远端网关配置…</span>
            {base && !isWslNative && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>

          <button
            type="button"
            role="menuitem"
            className={cn(rowCls, "text-muted-foreground")}
            onClick={() => {
              close();
              openWorkspacePicker();
            }}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">打开文件夹… (Ctrl+O)</span>
          </button>
        </div>
      )}
    </div>
  );
};
