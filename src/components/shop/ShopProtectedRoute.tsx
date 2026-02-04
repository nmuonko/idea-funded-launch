import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';

interface ShopProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute specifically for shop routes.
 * Redirects unauthenticated users to /shop/auth with a redirect parameter.
 */
export function ShopProtectedRoute({ children }: ShopProtectedRouteProps) {
  const { user, session, loading } = useAuth();
  const location = useLocation();

  console.log('[ShopProtectedRoute] Render:', { 
    userEmail: user?.email, 
    hasSession: !!session,
    loading, 
    path: location.pathname,
  });

  // Wait for auth to fully load before making any decisions
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
          <p className="text-sm text-white/60">Loading...</p>
        </div>
      </div>
    );
  }

  // User must have a valid session
  if (!session || !user) {
    console.log('[ShopProtectedRoute] ❌ No session - Redirecting to /shop/auth');
    // Encode the current path to redirect back after login
    const redirectPath = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/shop/auth?redirect=${redirectPath}`} replace />;
  }

  console.log('[ShopProtectedRoute] ✅ Access granted');
  return <>{children}</>;
}
