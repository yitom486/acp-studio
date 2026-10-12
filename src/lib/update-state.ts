/**
 * 自动更新状态机（渲染端），由主进程 desktop/updater.ts 经 IPC 推送事件驱动。
 * 流程仿 VS Code / Zed：发现新版 → 用户点“更新”后台下载 → 点“重启并更新”立即安装，
 * 不点则退出 / 下次启动时静默安装。
 */
export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string; notes?: string; canAutoInstall: boolean }
  | { type: "not-available" }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string; notes?: string; canAutoInstall: boolean; dismissed: boolean }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "ready"; version: string; dismissed: boolean }
  | { phase: "error"; message: string; version?: string };

export const initialUpdateState: UpdateState = { phase: "idle" };

export type UpdateAction = UpdateEvent | { type: "download-requested" } | { type: "dismiss" };

function versionOf(s: UpdateState): string | undefined {
  return "version" in s ? s.version : undefined;
}

export function updateReducer(state: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case "checking":
      // 已在下载或已就绪时，后台定时检查不应把 UI 打回去
      return state.phase === "downloading" || state.phase === "ready" ? state : { phase: "checking" };
    case "not-available":
      return state.phase === "checking" ? { phase: "idle" } : state;
    case "available":
      if (state.phase === "downloading" || state.phase === "ready") return state;
      return {
        phase: "available",
        version: action.version,
        notes: action.notes,
        canAutoInstall: action.canAutoInstall,
        dismissed: false,
      };
    case "download-requested":
      return state.phase === "available" || state.phase === "error"
        ? { phase: "downloading", version: versionOf(state) ?? "", percent: 0 }
        : state;
    case "progress":
      return state.phase === "downloading"
        ? { ...state, percent: Math.max(0, Math.min(100, Math.round(action.percent))) }
        : state;
    case "downloaded":
      return { phase: "ready", version: action.version, dismissed: false };
    case "error":
      return { phase: "error", message: action.message, version: versionOf(state) };
    case "dismiss":
      if (state.phase === "available" || state.phase === "ready") return { ...state, dismissed: true };
      if (state.phase === "error") return { phase: "idle" };
      return state;
  }
}
