import { create } from "zustand";

export type ThemeId = "dark" | "oled" | "dim" | "light";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
  badge: string;
  overlayColor: string;
  overlaySymbolColor: string;
  isDark: boolean;
}

export const THEMES: Record<ThemeId, ThemeMeta> = {
  dark: {
    id: "dark",
    name: "经典暗黑",
    description: "VS Code 现代蓝灰极客风格",
    badge: "Modern Dark",
    overlayColor: "#0b0e14",
    overlaySymbolColor: "#94a3b8",
    isDark: true,
  },
  oled: {
    id: "oled",
    name: "极黑深邃",
    description: "纯黑超高对比度，OLED 屏幕极致沉浸",
    badge: "Pitch Black",
    overlayColor: "#040508",
    overlaySymbolColor: "#94a3b8",
    isDark: true,
  },
  dim: {
    id: "dim",
    name: "柔和深灰",
    description: "低对比度炭黑夜间模式，舒适护眼",
    badge: "Charcoal Dim",
    overlayColor: "#171b24",
    overlaySymbolColor: "#94a3b8",
    isDark: true,
  },
  light: {
    id: "light",
    name: "清爽浅色",
    description: "透亮白日模式，清晰高质感",
    badge: "Light Modern",
    overlayColor: "#ffffff",
    overlaySymbolColor: "#334155",
    isDark: false,
  },
};

const THEME_STORAGE_KEY = "acp_studio_theme_v1";

function getInitialTheme(): ThemeId {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
      if (saved && saved in THEMES) return saved;
    }
  } catch {
    // fallback
  }
  return "dark";
}

function syncTitleBarOverlay(color: string, symbolColor: string) {
  if (typeof window === "undefined") return;
  const apply = () => {
    if (window.acpStudio?.setTitleBarOverlay) {
      window.acpStudio.setTitleBarOverlay({
        color,
        symbolColor,
        height: 32,
      }).catch(() => {});
    }
  };
  apply();
  // Retry on next tick in case bridge exposes just after script execution
  if (typeof setTimeout !== "undefined") {
    setTimeout(apply, 100);
  }
}

function applyThemeToDOM(themeId: ThemeId) {
  if (typeof document === "undefined") return;
  const meta = THEMES[themeId] || THEMES.dark;
  const root = document.documentElement;

  // Set data-theme attribute
  root.setAttribute("data-theme", meta.id);

  // Toggle dark class for Tailwind darkMode: "class"
  if (meta.isDark) {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.remove("dark");
    root.classList.add("light");
  }

  // Sync to Electron native title bar overlay
  syncTitleBarOverlay(meta.overlayColor, meta.overlaySymbolColor);
}

// Immediately apply theme on script load
if (typeof document !== "undefined") {
  applyThemeToDOM(getInitialTheme());
}

interface ThemeState {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  initTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getInitialTheme(),
  setTheme: (newTheme: ThemeId) => {
    if (!THEMES[newTheme]) return;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      }
    } catch {}
    applyThemeToDOM(newTheme);
    set({ theme: newTheme });
  },
  initTheme: () => {
    const current = get().theme;
    applyThemeToDOM(current);
  },
}));
