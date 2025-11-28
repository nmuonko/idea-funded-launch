import { useEffect, useState } from "react";

export interface ThemeColors {
  primary: string;
  primaryGlow: string;
  accent: string;
}

const DEFAULT_COLORS: ThemeColors = {
  primary: "200 98% 39%", // Deep ocean blue
  primaryGlow: "210 85% 45%",
  accent: "210 40% 98%",
};

const STORAGE_KEY = "afrishop-theme-colors";

export function useThemeCustomizer() {
  const [colors, setColors] = useState<ThemeColors>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_COLORS;
  });

  useEffect(() => {
    // Apply colors to CSS variables
    const root = document.documentElement;
    root.style.setProperty("--primary", colors.primary);
    root.style.setProperty("--primary-glow", colors.primaryGlow);
    root.style.setProperty("--accent", colors.accent);

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
      colors.accent === DEFAULT_COLORS.accent,
  };
}
