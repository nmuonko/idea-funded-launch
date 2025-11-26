import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import AccessDenied from '@/pages/AccessDenied';

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

  // Admin required but user is not logged in or not admin - show access denied
  if (requireAdmin && (!user || !isAdmin)) {
    console.log('[ProtectedRoute] Admin access denied:', { hasUser: !!user, isAdmin });
    return <AccessDenied />;
  }

  // Regular protected route - user must be logged in
  if (!user) {
    console.log('[ProtectedRoute] No user, showing access denied');
    return <AccessDenied />;
  }

  console.log('[ProtectedRoute] Access granted');
  return <>{children}</>;
}
