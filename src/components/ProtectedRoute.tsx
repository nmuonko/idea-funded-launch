import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, isAdmin, loading } = useAuth();

  console.log('[ProtectedRoute]', { user: user?.email, isAdmin, loading, requireAdmin });

  // Show loading only briefly - if stuck loading for too long, something is wrong
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not logged in - redirect to auth
  if (!user) {
    console.log('[ProtectedRoute] No user, redirecting to /auth');
    return <Navigate to="/auth" replace />;
  }

  // Admin required but user is not admin
  if (requireAdmin && !isAdmin) {
    console.log('[ProtectedRoute] Admin required but user is not admin, redirecting to /');
    return <Navigate to="/" replace />;
  }

  console.log('[ProtectedRoute] Access granted');
  return <>{children}</>;
}
