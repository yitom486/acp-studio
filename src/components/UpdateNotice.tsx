import React, { useEffect, useReducer } from "react";
import { Download, RotateCw, X, ExternalLink } from "lucide-react";
import { initialUpdateState, updateReducer, type UpdateEvent } from "@/lib/update-state";

/**
 * 右下角更新提示（仅 Electron 打包版）：发现新版 → [更新] 后台下载 → [重启并更新]。
 * 关掉提示不影响：已下载的更新会在退出/下次启动时静默安装。
 */
export const UpdateNotice: React.FC = () => {
  const api = typeof window !== "undefined" ? window.acpStudio?.updates : undefined;
  const [state, dispatch] = useReducer(updateReducer, initialUpdateState);

  useEffect(() => {
    if (!api) return;
    return api.onEvent((e) => dispatch(e as UpdateEvent));
  }, [api]);

  if (!api) return null;

  const card = (children: React.ReactNode) => (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-[90] w-72 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md"
    >
      {children}
    </div>
  );
  const close = (
    <button aria-label="关闭" className="text-muted-foreground hover:text-foreground" onClick={() => dispatch({ type: "dismiss" })}>
      <X className="h-3.5 w-3.5" />
    </button>
  );
  const btn = "inline-flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-accent";
  const primary = "inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-primary-foreground hover:opacity-90";

  switch (state.phase) {
    case "available":
      if (state.dismissed) return null;
      return card(
        <>
          <div className="mb-2 flex items-start justify-between">
            <span className="font-medium">有新版本 {state.version}</span>
            {close}
          </div>
          <div className="flex gap-2">
            {state.canAutoInstall ? (
              <button
                className={primary}
                onClick={() => {
                  dispatch({ type: "download-requested" });
                  void api.download();
                }}
              >
                <Download className="h-3.5 w-3.5" /> 更新
              </button>
            ) : (
              <button className={primary} onClick={() => void api.openReleases()}>
                <ExternalLink className="h-3.5 w-3.5" /> 前往下载
              </button>
            )}
            <button className={btn} onClick={() => void api.openReleases()}>
              更新内容
            </button>
          </div>
        </>,
      );
    case "downloading":
      return card(
        <>
          <div className="mb-2">正在下载 {state.version}… {state.percent}%</div>
          <div className="h-1 w-full overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${state.percent}%` }} />
          </div>
        </>,
      );
    case "ready":
      if (state.dismissed) return null;
      return card(
        <>
          <div className="mb-1 flex items-start justify-between">
            <span className="font-medium">{state.version} 已就绪</span>
            {close}
          </div>
          <div className="mb-2 text-muted-foreground">重启即可完成更新；不重启也会在下次打开时自动安装。</div>
          <button className={primary} onClick={() => void api.install()}>
            <RotateCw className="h-3.5 w-3.5" /> 重启并更新
          </button>
        </>,
      );
    case "error":
      return card(
        <>
          <div className="mb-1 flex items-start justify-between">
            <span className="font-medium">更新失败</span>
            {close}
          </div>
          <div className="mb-2 break-words text-muted-foreground">{state.message}</div>
          <div className="flex gap-2">
            <button className={btn} onClick={() => void api.check()}>重试</button>
            <button className={btn} onClick={() => void api.openReleases()}>手动下载</button>
          </div>
        </>,
      );
    default:
      return null;
  }
};
