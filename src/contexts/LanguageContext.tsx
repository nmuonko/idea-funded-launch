import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Language, getTranslation } from '@/lib/i18n/translations';
import { supabase } from '@/integrations/supabase/client';

// French-speaking African countries (ISO 3166-1 alpha-2)
const FRENCH_SPEAKING_COUNTRIES = [
  'CD', 'CG', 'CF', 'CM', 'BI', 'RW', 'GN', 'BJ', 'CI', 'SN', 
  'ML', 'TD', 'NE', 'GA', 'TG', 'BF', 'MG', 'DJ', 'KM', 'SC'
];

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: ReturnType<typeof getTranslation>;
  isLanguageLoaded: boolean;
  saveLanguageToProfile: (lang: Language) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

/**
 * Detect the best default language based on browser locale
 */
function detectBrowserLanguage(): Language {
  try {
    const browserLang = navigator.language || (navigator as any).userLanguage || '';
    const languages = navigator.languages || [browserLang];
    
    // Check if any of the browser languages start with 'fr'
    for (const lang of languages) {
      if (lang.toLowerCase().startsWith('fr')) {
        return 'fr';
      }
      if (lang.toLowerCase().startsWith('sw')) {
        return 'sw';
      }
      if (lang.toLowerCase().startsWith('ln')) {
        return 'ln';
      }
    }
    
    // Check region code (e.g., "en-CD" for English speaker in DRC)
    for (const lang of languages) {
      const parts = lang.split('-');
      if (parts.length > 1) {
        const region = parts[1].toUpperCase();
        if (FRENCH_SPEAKING_COUNTRIES.includes(region)) {
          return 'fr';
        }
      }
    }
    
    // Default to French for this Africa-focused app
    return 'fr';
  } catch {
    return 'fr';
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('fr');
  const [isLanguageLoaded, setIsLanguageLoaded] = useState(false);

  // Initialize language on mount
  useEffect(() => {
    const initializeLanguage = async () => {
      // Check localStorage first
      const savedLanguage = localStorage.getItem('language') as Language | null;
      
      if (savedLanguage && ['fr', 'en', 'sw', 'ln'].includes(savedLanguage)) {
        setLanguageState(savedLanguage);
        setIsLanguageLoaded(true);
        return;
      }
      
      // No saved language - auto-detect
      const detectedLanguage = detectBrowserLanguage();
      setLanguageState(detectedLanguage);
      localStorage.setItem('language', detectedLanguage);
      
      // Also mark that we've set the language preference
      localStorage.setItem('afrishop_language_set', 'true');
      
      setIsLanguageLoaded(true);
    };

    initializeLanguage();
  }, []);

  // Load language from Supabase profile when user logs in
  useEffect(() => {
    const loadLanguageFromProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('language')
          .eq('user_id', session.user.id)
          .maybeSingle();
        
        if (profile?.language && ['fr', 'en', 'sw', 'ln'].includes(profile.language)) {
          setLanguageState(profile.language as Language);
          localStorage.setItem('language', profile.language);
          localStorage.setItem('afrishop_language_set', 'true');
        }
      }
    };

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        loadLanguageFromProfile();
      }
    });

    // Initial load
    loadLanguageFromProfile();

    return () => subscription.unsubscribe();
  }, []);

  const saveLanguageToProfile = useCallback(async (lang: Language) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await supabase
        .from('profiles')
        .update({ language: lang })
        .eq('user_id', session.user.id);
    }
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('language', lang);
    localStorage.setItem('afrishop_language_set', 'true');
    
    // Save to profile in background
    saveLanguageToProfile(lang);
  }, [saveLanguageToProfile]);

  const t = getTranslation(language);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isLanguageLoaded, saveLanguageToProfile }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
