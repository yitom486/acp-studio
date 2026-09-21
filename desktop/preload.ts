import { contextBridge, ipcRenderer } from "electron";

/** Minimal bridge: version/platform info + native dialogs. All ACP traffic stays on HTTP. */
contextBridge.exposeInMainWorld("acpStudio", {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  openDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:openDirectory"),
  openPath: (p: string): Promise<void> => ipcRenderer.invoke("shell:openPath", p),
});

declare global {
  interface Window {
    acpStudio?: {
      platform: string;
      versions: Record<string, string | undefined>;
      openDirectory?: () => Promise<string | null>;
      openPath?: (p: string) => Promise<void>;
    };
  }
}
