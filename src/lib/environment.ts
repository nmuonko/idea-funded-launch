/**
 * Environment detection utilities
 */

export const isLovablePreview = (): boolean => {
  return typeof window !== 'undefined' && 
    window.location.hostname.includes('lovableproject.com');
};

export const isProduction = (): boolean => {
  return typeof window !== 'undefined' && 
    (window.location.hostname === 'afrishop-usa.com' || 
     window.location.hostname === 'www.afrishop-usa.com');
};

export const getEnvironmentName = (): string => {
  if (isProduction()) return 'production';
  if (isLovablePreview()) return 'preview';
  return 'development';
};
