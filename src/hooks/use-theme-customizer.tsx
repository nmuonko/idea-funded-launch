import { useEffect, useState } from "react";

export interface ThemeColors {
  primary: string;
  primaryGlow: string;
  accent: string;
  sidebarBackground: string;
}

const DEFAULT_COLORS: ThemeColors = {
  primary: "217 91% 60%", // Bright blue
  primaryGlow: "210 85% 45%",
  accent: "210 40% 98%",
  sidebarBackground: "222 47% 11%", // Dark blue sidebar
};

const STORAGE_KEY = "afrishop-theme-colors";

export function useThemeCustomizer() {
  const [colors, setColors] = useState<ThemeColors>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle missing fields
      return {
        ...DEFAULT_COLORS,
        ...parsed,
      };
    }
    return DEFAULT_COLORS;
  });

  useEffect(() => {
    // Apply colors to CSS variables
    const root = document.documentElement;
    root.style.setProperty("--primary", colors.primary);
    root.style.setProperty("--primary-glow", colors.primaryGlow);
    root.style.setProperty("--accent", colors.accent);
    root.style.setProperty("--sidebar-background", colors.sidebarBackground);
    
    // Apply primary color to background with adjusted lightness
    const [h, s, l] = colors.primary.split(" ").map(v => parseFloat(v));
    const isDark = document.documentElement.classList.contains("dark");
    
    if (isDark) {
      // Dark mode: use darker version of primary
      root.style.setProperty("--background", `${h} ${Math.min(s, 30)}% ${Math.max(l * 0.2, 6)}%`);
    } else {
      // Light mode: use very light version of primary
      root.style.setProperty("--background", `${h} ${Math.min(s, 40)}% ${Math.max(96 - (l * 0.1), 94)}%`);
    }

    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  }, [colors]);

  const updateColor = (key: keyof ThemeColors, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }));
  };

  const resetToDefault = () => {
    setColors(DEFAULT_COLORS);
  };

  return {
    colors,
    updateColor,
    resetToDefault,
    isDefault:
      colors.primary === DEFAULT_COLORS.primary &&
      colors.primaryGlow === DEFAULT_COLORS.primaryGlow &&
      colors.accent === DEFAULT_COLORS.accent &&
      colors.sidebarBackground === DEFAULT_COLORS.sidebarBackground,
  };
}
