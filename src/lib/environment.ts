/**
 * Environment detection utilities
 */

export const isLovablePreview = (): boolean => {
  return typeof window !== 'undefined' && 
    window.location.hostname.includes('lovableproject.com');
};

export const isCapacitorApp = (): boolean => {
  return typeof window !== 'undefined' && 
    ((window as any).Capacitor !== undefined || navigator.userAgent.toLowerCase().includes('capacitor'));
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
  // Root path "/" is now the shop, along with other shop paths
  const shopPaths = ['/', '/cart', '/checkout', '/saved', '/my-orders', '/account', '/search', '/product', '/shop-auth', '/onboarding', '/payment-pending', '/card-payment', '/payment-success-shop'];
  // Exclude admin and other non-shop paths
  const excludedPaths = ['/admin', '/auth', '/how-it-works', '/about', '/coverage', '/privacy', '/terms', '/payments-compliance', '/refunds', '/payouts', '/contact', '/delete-account', '/download', '/cars', '/knowledge-base', '/track-order', '/payment', '/orders', '/profile', '/support', '/accept-invite', '/email-confirmed'];
  if (excludedPaths.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'))) {
    return false;
  }
  return shopPaths.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
};
