import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type ThemePreset = 'DefaultDark' | 'DefaultLight' | 'BlueAccent' | 'PurpleAccent' | 'Custom';

export interface AdminThemeSettings {
  backgroundColor: string;
  sidebarColor: string;
  accentColor: string;
  borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  mode: 'light' | 'dark';
  activePreset: ThemePreset;
}

interface AdminThemeContextType {
  theme: AdminThemeSettings;
  setTheme: (theme: Partial<AdminThemeSettings>) => void;
  setThemeWithoutPresetChange: (theme: Partial<AdminThemeSettings>) => void;
  applyPreset: (preset: ThemePreset) => void;
  isLoading: boolean;
  saveTheme: () => Promise<boolean>;
  resetToDefaults: () => void;
  hasChanges: boolean;
}

export const THEME_PRESETS: Record<ThemePreset, Omit<AdminThemeSettings, 'activePreset'>> = {
  DefaultDark: {
    backgroundColor: '#0a0a0a',
    sidebarColor: '#0f0f0f',
    accentColor: '#3b82f6',
    borderRadius: 'md',
    mode: 'dark',
  },
  DefaultLight: {
    backgroundColor: '#f8fafc',
    sidebarColor: '#ffffff',
    accentColor: '#3b82f6',
    borderRadius: 'md',
    mode: 'light',
  },
  BlueAccent: {
    backgroundColor: '#0D1117',
    sidebarColor: '#161b22',
    accentColor: '#58a6ff',
    borderRadius: 'md',
    mode: 'dark',
  },
  PurpleAccent: {
    backgroundColor: '#1a1a2e',
    sidebarColor: '#16213e',
    accentColor: '#a855f7',
    borderRadius: 'lg',
    mode: 'dark',
  },
  Custom: {
    backgroundColor: '#0a0a0a',
    sidebarColor: '#0f0f0f',
    accentColor: '#3b82f6',
    borderRadius: 'md',
    mode: 'dark',
  },
};

const AdminThemeContext = createContext<AdminThemeContextType | undefined>(undefined);

const DEFAULT_THEME: AdminThemeSettings = {
  ...THEME_PRESETS.DefaultDark,
  activePreset: 'DefaultDark',
};

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AdminThemeSettings>(DEFAULT_THEME);
  const [savedTheme, setSavedTheme] = useState<AdminThemeSettings>(DEFAULT_THEME);
  const [isLoading, setIsLoading] = useState(true);

  const hasChanges = JSON.stringify(theme) !== JSON.stringify(savedTheme);

  useEffect(() => {
    loadThemeSettings();
  }, []);

  // Apply CSS variables whenever theme changes
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  const applyThemeToDOM = (t: AdminThemeSettings) => {
    const root = document.documentElement;
    root.style.setProperty('--admin-bg', t.backgroundColor);
    root.style.setProperty('--admin-sidebar-bg', t.sidebarColor);
    root.style.setProperty('--admin-accent', t.accentColor);
    
    // Border radius mapping
    const radiusMap = { none: '0', sm: '0.25rem', md: '0.5rem', lg: '0.75rem', xl: '1rem' };
    root.style.setProperty('--admin-radius', radiusMap[t.borderRadius]);
  };

  const loadThemeSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('key, value')
        .like('key', 'theme_%');

      if (!error && data) {
        const loadedTheme = { ...DEFAULT_THEME };
        data.forEach(({ key, value }) => {
          const themeKey = key.replace('theme_', '') as keyof AdminThemeSettings;
          if (themeKey in loadedTheme) {
            (loadedTheme as any)[themeKey] = value;
          }
        });
        setThemeState(loadedTheme);
        setSavedTheme(loadedTheme);
      }
    } catch (error) {
      console.error('Error loading theme settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // setTheme auto-switches to Custom preset when manually changing values
  const setTheme = (updates: Partial<AdminThemeSettings>) => {
    setThemeState(prev => {
      const newTheme = { ...prev, ...updates };
      // Auto-switch to Custom if user manually changes colors/mode (not activePreset itself)
      if (!('activePreset' in updates) && prev.activePreset !== 'Custom') {
        newTheme.activePreset = 'Custom';
      }
      return newTheme;
    });
  };

  // setThemeWithoutPresetChange - used internally when applying presets
  const setThemeWithoutPresetChange = (updates: Partial<AdminThemeSettings>) => {
    setThemeState(prev => ({ ...prev, ...updates }));
  };

  // Apply a preset - sets all theme values from the preset
  const applyPreset = (preset: ThemePreset) => {
    const presetValues = THEME_PRESETS[preset];
    setThemeState({
      ...presetValues,
      activePreset: preset,
    });
  };

  const saveTheme = async (): Promise<boolean> => {
    try {
      const entries = Object.entries(theme).map(([key, value]) => ({
        key: `theme_${key}`,
        value: String(value),
      }));

      for (const entry of entries) {
        const { error } = await supabase
          .from('admin_settings')
          .upsert(entry, { onConflict: 'key' });

        if (error) {
          console.error('Error saving theme setting:', error);
          return false;
        }
      }

      setSavedTheme(theme);
      return true;
    } catch (error) {
      console.error('Error saving theme:', error);
      return false;
    }
  };

  const resetToDefaults = () => {
    setThemeState(DEFAULT_THEME);
  };

  return (
    <AdminThemeContext.Provider value={{ 
      theme,
      setTheme,
      setThemeWithoutPresetChange,
      applyPreset,
      isLoading,
      saveTheme,
      resetToDefaults,
      hasChanges,
    }}>
      {children}
    </AdminThemeContext.Provider>
  );
}

export function useAdminTheme() {
  const context = useContext(AdminThemeContext);
  if (context === undefined) {
    throw new Error('useAdminTheme must be used within an AdminThemeProvider');
  }
  return context;
}
