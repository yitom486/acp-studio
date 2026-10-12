/**
 * 状态栏远程角标（VSCode 左下角式）：当前环境一眼可见，点开切换。
 * - 本机：本地网关 + 本地工作区
 * - WSL: <distro>：工作区在 \\wsl$\ 里（网关仍在本地，经 wsl.exe 干活）
 * - 远端 <host>：自定义网关基址（网关在 WSL/SSH 里跑）
 * WSL 发行版列表来自网关（5 分钟缓存，开菜单才查）；切环境走已有命令
 * （workspace.open 带校验、设置页网关 Tab），这里不造新流程。
 */
import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, FolderOpen, Monitor, Server, Terminal } from "lucide-react";
import { useStudioStore } from "@/stores/useStudioStore";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { getGatewayBase, setGatewayBase, gatewayHost } from "@/lib/gateway-auth";
import { listWslDistros } from "@/lib/universal-api";
import { parseWslDistro } from "@/lib/wsl-distro";
import { runCommand } from "@/lib/commands";
import { cn } from "@/lib/utils";

const menuCls =
  "absolute bottom-6 left-1 z-50 min-w-64 max-w-80 rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-lg";

const rowCls =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent";

export const RemoteButton: React.FC = () => {
  const currentWorkspace = useStudioStore((s) => s.currentWorkspace);
  const recentWorkspaces = useStudioStore((s) => s.recentWorkspaces);
  const openSettings = useWorkbenchStore((s) => s.openSettings);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const base = getGatewayBase();
  const distro = currentWorkspace ? parseWslDistro(currentWorkspace) : null;

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

  const close = () => setMenuOpen(false);

  const openWslFolder = (d: string) => {
    close();
    const p = window.prompt("WSL 里的工作区路径", `\\\\wsl$\\${d}\\home\\`);
    if (p && p.trim()) void runCommand("workspace.open", p.trim());
  };

  const backToLocal = () => {
    setGatewayBase("");
    // 状态归属网关：回本地即重载（与设置页行为一致）
    window.location.reload();
  };

  const label = base ? `远端 ${gatewayHost(base)}` : distro ? `WSL: ${distro}` : "本机";
  const title = base
    ? `经远端网关 ${base} 连接（点此切换）`
    : distro
      ? `WSL 发行版 ${distro}（本地网关经 wsl.exe，点此切换）`
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
          base || distro
            ? "bg-primary text-primary-foreground hover:opacity-90"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <span aria-hidden>{"><"}</span>
        <span className="max-w-48 truncate">{label}</span>
      </button>
      {menuOpen && (
        <div className={menuCls} role="menu" aria-label="切换环境">
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            当前：{label}
          </div>
          <button type="button" role="menuitem" className={rowCls} onClick={() => (base ? backToLocal() : close())}>
            <Monitor className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">本机</span>
            {!base && !distro && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>
          {showWsl && (
            <>
              <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                WSL
              </div>
              {distrosQuery.isPending && <div className="px-2 py-1.5 text-muted-foreground">正在读取发行版…</div>}
              {distrosQuery.isError && !distro && (
                <div className="px-2 py-1.5 text-muted-foreground">本机无 WSL（或网关不可达）</div>
              )}
              {distros.map((d) => (
                <div key={d}>
                  <button type="button" role="menuitem" className={rowCls} onClick={() => openWslFolder(d)}>
                    <Terminal className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 truncate">WSL: {d}</span>
                    {distro === d && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                  {recentWorkspaces
                    .filter((r) => parseWslDistro(r.path)?.toLowerCase() === d.toLowerCase())
                    .slice(0, 5)
                    .map((r) => (
                      <button
                        key={r.path}
                        type="button"
                        role="menuitem"
                        className={cn(rowCls, "pl-8")}
                        title={r.path}
                        onClick={() => {
                          close();
                          void runCommand("workspace.open", r.path);
                        }}
                      >
                        <span className="flex-1 truncate">{r.name}</span>
                        {currentWorkspace === r.path && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    ))}
                </div>
              ))}
            </>
          )}
          <div className="my-1 h-px bg-border" />
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
            <span className="flex-1">远端网关…</span>
            {base && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>
          {base && (
            <div className="px-2 py-1 font-mono text-[10px] text-muted-foreground truncate" title={base}>
              经 {gatewayHost(base)} 连接
            </div>
          )}
          <button type="button" role="menuitem" className={cn(rowCls, "text-muted-foreground")} onClick={() => { close(); void runCommand("workspace.openFolder"); }}>
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">打开文件夹…（Ctrl+O）</span>
          </button>
        </div>
      )}
    </div>
  );
};
