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
    name: "深色",
    description: "默认。中性深灰底色（vercel 配色，底色抬亮到 7%）",
    badge: "Dark",
    overlayColor: "#171717",
    overlaySymbolColor: "#a5a5a5",
    isDark: true,
  },
  oled: {
    id: "oled",
    name: "纯黑",
    description: "纯黑底色，适合 OLED 屏幕",
    badge: "OLED",
    overlayColor: "#080808",
    overlaySymbolColor: "#a5a5a5",
    isDark: true,
  },
  dim: {
    id: "dim",
    name: "暗灰",
    description: "中灰底色，对比更柔和，适合长时间使用",
    badge: "Dim",
    overlayColor: "#202020",
    overlaySymbolColor: "#b0b0b0",
    isDark: true,
  },
  light: {
    id: "light",
    name: "浅色",
    description: "近白底色，适合白天和投屏",
    badge: "Light",
    overlayColor: "#fcfcfc",
    overlaySymbolColor: "#525252",
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

let themeTransitionTimer: ReturnType<typeof setTimeout> | null = null;

function applyThemeToDOM(themeId: ThemeId, isUserSwitch = false) {
  if (typeof document === "undefined") return;
  const meta = THEMES[themeId] || THEMES.dark;
  const root = document.documentElement;

  if (isUserSwitch) {
    // Read dynamic duration token from CSS variable (single source of truth)
    const cssDuration = getComputedStyle(root).getPropertyValue("--theme-transition-duration").trim();
    const parsedDuration = parseInt(cssDuration, 10);
    const durationMs = Number.isFinite(parsedDuration) ? parsedDuration : 200;

    root.classList.add("theme-transitioning");
    if (themeTransitionTimer) clearTimeout(themeTransitionTimer);
    themeTransitionTimer = setTimeout(() => {
      root.classList.remove("theme-transitioning");
    }, durationMs + 30);
  }

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

// Immediately apply theme on script load (cold boot: no animation to avoid flicker)
if (typeof document !== "undefined") {
  applyThemeToDOM(getInitialTheme(), false);
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
    // User triggered theme toggle: trigger synchronized smooth transition
    applyThemeToDOM(newTheme, true);
    set({ theme: newTheme });
  },
  initTheme: () => {
    const current = get().theme;
    applyThemeToDOM(current, false);
  },
}));
