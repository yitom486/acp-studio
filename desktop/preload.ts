import { contextBridge } from "electron";

/** Minimal bridge: version/platform info only. All ACP traffic stays on HTTP. */
contextBridge.exposeInMainWorld("acpStudio", {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});

declare global {
  interface Window {
    acpStudio?: {
      platform: string;
      versions: Record<string, string | undefined>;
    };
  }
}
