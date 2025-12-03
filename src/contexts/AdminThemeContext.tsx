import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface AdminThemeContextType {
  backgroundColor: string;
  setBackgroundColor: (color: string) => void;
  isLoading: boolean;
  saveBackgroundColor: (color: string) => Promise<boolean>;
}

const AdminThemeContext = createContext<AdminThemeContextType | undefined>(undefined);

const DEFAULT_BG_COLOR = '#0a0a0a';

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BG_COLOR);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadThemeSettings();
  }, []);

  const loadThemeSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('value')
        .eq('key', 'dashboard_background_color')
        .single();

      if (!error && data?.value) {
        setBackgroundColor(data.value);
      }
    } catch (error) {
      console.error('Error loading theme settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveBackgroundColor = async (color: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('admin_settings')
        .upsert(
          { key: 'dashboard_background_color', value: color },
          { onConflict: 'key' }
        );

      if (error) {
        console.error('Error saving theme:', error);
        return false;
      }

      setBackgroundColor(color);
      return true;
    } catch (error) {
      console.error('Error saving theme:', error);
      return false;
    }
  };

  return (
    <AdminThemeContext.Provider value={{ 
      backgroundColor, 
      setBackgroundColor, 
      isLoading,
      saveBackgroundColor 
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
