import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, session, isAdmin, isAuthReady } = useAuth();
  const location = useLocation();

  console.log('[ProtectedRoute] Render:', { 
    userEmail: user?.email, 
    userId: user?.id,
    hasSession: !!session,
    isAdmin, 
    isAuthReady,
    requireAdmin,
    path: location.pathname,
    timestamp: new Date().toISOString()
  });

  // Route protection must depend only on auth hydration and session.
  if (!isAuthReady) {
    console.log('[ProtectedRoute] Waiting for auth hydration...');
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Check 1: Session alone determines authenticated access
  if (!session) {
    console.log('[ProtectedRoute] ❌ No session - Redirecting to auth');
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Check 2: If admin is required, verify admin status
  if (requireAdmin && !isAdmin) {
    console.log('[ProtectedRoute] ❌ Admin required but user is not admin - Redirecting to home');
    return <Navigate to="/" replace />;
  }

  console.log('[ProtectedRoute] ✅ Access granted');
  return <>{children}</>;
}
