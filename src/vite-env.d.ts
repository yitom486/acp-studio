/// <reference types="vite/client" />

interface Window {
  acpStudio?: {
    platform: string;
    versions: Record<string, string | undefined>;
    openDirectory?: () => Promise<string | null>;
    openPath?: (p: string) => Promise<void>;
  };
}
