/// <reference types="vite/client" />

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
  };
}
