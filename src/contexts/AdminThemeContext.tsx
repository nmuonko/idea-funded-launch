import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AdminThemeSettings {
  backgroundColor: string;
  sidebarColor: string;
  accentColor: string;
  borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  mode: 'light' | 'dark';
}

interface AdminThemeContextType {
  theme: AdminThemeSettings;
  setTheme: (theme: Partial<AdminThemeSettings>) => void;
  isLoading: boolean;
  saveTheme: () => Promise<boolean>;
  resetToDefaults: () => void;
  hasChanges: boolean;
}

const AdminThemeContext = createContext<AdminThemeContextType | undefined>(undefined);

const DEFAULT_THEME: AdminThemeSettings = {
  backgroundColor: '#0a0a0a',
  sidebarColor: '#0f0f0f',
  accentColor: '#3b82f6',
  borderRadius: 'md',
  mode: 'dark',
};

const LIGHT_DEFAULTS: Partial<AdminThemeSettings> = {
  backgroundColor: '#f8fafc',
  sidebarColor: '#ffffff',
  mode: 'light',
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

  const setTheme = (updates: Partial<AdminThemeSettings>) => {
    setThemeState(prev => {
      const newTheme = { ...prev, ...updates };
      
      // If switching modes, apply default colors for that mode
      if (updates.mode && updates.mode !== prev.mode) {
        if (updates.mode === 'light') {
          return { ...newTheme, ...LIGHT_DEFAULTS };
        } else {
          return { ...newTheme, backgroundColor: DEFAULT_THEME.backgroundColor, sidebarColor: DEFAULT_THEME.sidebarColor };
        }
      }
      
      return newTheme;
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
