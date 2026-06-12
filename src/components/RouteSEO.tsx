import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';

// Routes that must NEVER be indexed (per-user, transactional, auth, admin).
// Matched by prefix against the current pathname.
const NOINDEX_PREFIXES = [
  '/admin',
  '/auth',
  '/shop-auth',
  '/account',
  '/profile',
  '/checkout',
  '/cart',
  '/saved',
  '/my-orders',
  '/orders',
  '/order/',
  '/onboarding',
  '/payment-pending',
  '/payment-callback',
  '/payment-success',
  '/payment-success-shop',
  '/payment-fail',
  '/card-payment',
  '/accept-invite',
  '/delete-account',
  '/reset-password',
  '/email-confirmed',
  '/auth-callback',
  '/access-denied',
  '/track-order',
  '/dubai-upload',
  '/dubai',
  '/share',
  '/share/',
  '/bundle/',
  '/admin-login',
];

/**
 * Global SEO controller. Adds a noindex meta tag on private/per-user/
 * transactional routes so Google removes them from the index.
 */
export function RouteSEO() {
  const { pathname } = useLocation();
  const shouldNoIndex = NOINDEX_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`) || pathname === p,
  );

  if (!shouldNoIndex) return null;

  return (
    <Helmet>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="googlebot" content="noindex, nofollow" />
    </Helmet>
  );
}

export default RouteSEO;
