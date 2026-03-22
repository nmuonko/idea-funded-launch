import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, session, isAdmin, isAuthReady, isAdminReady } = useAuth();
  const location = useLocation();

  // For non-admin routes, only wait for basic auth hydration
  if (!isAuthReady) {
    return null; // Brief flash — auth resolves quickly
  }

  // For admin routes, also wait for admin status to resolve
  if (requireAdmin && !isAdminReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading admin...</p>
        </div>
      </div>
    );
  }

  // Check 1: Session alone determines authenticated access
  if (!session) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Check 2: If admin is required, verify admin status
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
