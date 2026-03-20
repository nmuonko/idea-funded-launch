import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTokenFromUrl } from '@/hooks/useTokenFromUrl';

interface ShopProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute for shop routes.
 *
 * CRITICAL: Does NOT redirect until BOTH conditions are met:
 *   1. isAuthReady === true (Supabase auth hydration complete)
 *   2. bootstrapping === false (URL handoff/token bootstrap complete)
 *
 * This prevents the race condition where ShopProtectedRoute redirects to /shop-auth
 * before the WebView handoff has had a chance to establish a session.
 *
 * Checkpoint logs:
 *   [ShopProtectedRoute] waiting-for-auth
 *   [ShopProtectedRoute] waiting-for-handoff-bootstrap
 *   [ShopProtectedRoute] redirect-to-login (reason)
 *   [ShopProtectedRoute] access-granted
 */
export function ShopProtectedRoute({ children }: ShopProtectedRouteProps) {
  const { user, session, isAuthReady } = useAuth();
  const location = useLocation();
  const { bootstrapping, bootstrapped } = useTokenFromUrl();

  // ── Checkpoint: waiting for auth hydration ──
  if (!isAuthReady) {
    console.log('[ShopProtectedRoute] waiting-for-auth path=' + location.pathname);
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
          <p className="text-sm text-white/60">Loading...</p>
        </div>
      </div>
    );
  }

  // ── Checkpoint: waiting for handoff/token bootstrap ──
  if (bootstrapping) {
    console.log('[ShopProtectedRoute] waiting-for-handoff-bootstrap path=' + location.pathname);
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
          <p className="text-sm text-white/60">Authenticating...</p>
        </div>
      </div>
    );
  }

  // ── Checkpoint: no session after everything completed ──
  if (!session) {
    const redirectPath = encodeURIComponent(location.pathname + location.search);
    const reason = bootstrapped
      ? 'bootstrapped-but-session-missing'
      : 'no-session-no-handoff';
    console.log('[ShopProtectedRoute] redirect-to-login reason=' + reason + ' path=' + location.pathname + ' bootstrapped=' + bootstrapped);
    return <Navigate to={`/shop-auth?redirect=${redirectPath}`} replace />;
  }

  // ── Checkpoint: access granted ──
  console.log('[ShopProtectedRoute] access-granted email=' + user?.email + ' path=' + location.pathname);
  return <>{children}</>;
}
