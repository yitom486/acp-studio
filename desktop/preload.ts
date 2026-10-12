import { contextBridge, ipcRenderer } from "electron";

/**
 * Minimal bridge: version/platform info + native dialogs + gateway token.
 * All ACP traffic stays on HTTP; the token authenticates it (see src/lib/gateway-auth.ts).
 */
contextBridge.exposeInMainWorld("acpStudio", {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  getGatewayToken: (): Promise<string> => ipcRenderer.invoke("gateway:getToken"),
  openDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:openDirectory"),
  openPath: (p: string): Promise<void> => ipcRenderer.invoke("shell:openPath", p),
  setTitleBarOverlay: (opts: { color?: string; symbolColor?: string; height?: number }): Promise<void> =>
    ipcRenderer.invoke("window:setTitleBarOverlay", opts),
  minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  maximize: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  close: (): Promise<void> => ipcRenderer.invoke("window:close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),
  updates: {
    getInfo: (): Promise<{ version: string; enabled: boolean; canAutoInstall: boolean }> =>
      ipcRenderer.invoke("update:getInfo"),
    check: (): Promise<void> => ipcRenderer.invoke("update:check"),
    download: (): Promise<void> => ipcRenderer.invoke("update:download"),
    install: (): Promise<void> => ipcRenderer.invoke("update:install"),
    openReleases: (): Promise<void> => ipcRenderer.invoke("update:openReleases"),
    onEvent: (cb: (e: unknown) => void): (() => void) => {
      const h = (_: unknown, e: unknown) => cb(e);
      ipcRenderer.on("update:event", h);
      return () => ipcRenderer.removeListener("update:event", h);
    },
  },
});

declare global {
  interface Window {
    acpStudio?: {
      platform: string;
      versions: Record<string, string | undefined>;
      getGatewayToken?: () => Promise<string>;
      openDirectory?: () => Promise<string | null>;
      openPath?: (p: string) => Promise<void>;
      setTitleBarOverlay?: (opts: { color?: string; symbolColor?: string; height?: number }) => Promise<void>;
      minimize?: () => Promise<void>;
      maximize?: () => Promise<void>;
      close?: () => Promise<void>;
      isMaximized?: () => Promise<boolean>;
      updates?: {
        getInfo: () => Promise<{ version: string; enabled: boolean; canAutoInstall: boolean }>;
        check: () => Promise<void>;
        download: () => Promise<void>;
        install: () => Promise<void>;
        openReleases: () => Promise<void>;
        onEvent: (cb: (e: unknown) => void) => () => void;
      };
    };
  }
}
