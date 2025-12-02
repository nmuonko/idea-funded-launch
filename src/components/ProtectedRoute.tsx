import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, session, isAdmin, loading } = useAuth();
  const location = useLocation();

  console.log('[ProtectedRoute] Render:', { 
    userEmail: user?.email, 
    userId: user?.id,
    hasSession: !!session,
    isAdmin, 
    loading, 
    requireAdmin,
    path: location.pathname,
    timestamp: new Date().toISOString()
  });

  // CRITICAL: Wait for auth to fully load before making any decisions
  if (loading) {
    console.log('[ProtectedRoute] Waiting for auth to load...');
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Check 1: User must have a valid session
  if (!session || !user) {
    console.log('[ProtectedRoute] ❌ No session/user - Redirecting to auth');
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
