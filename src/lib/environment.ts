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

/**
 * Check if the current path is a shop route
 */
export const isShopRoute = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  const shopPaths = ['/browse', '/cart', '/checkout', '/saved', '/my-orders', '/account', '/search', '/product', '/shop-auth', '/onboarding', '/payment-pending', '/card-payment', '/payment-success-shop'];
  return shopPaths.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
};
