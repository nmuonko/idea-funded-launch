import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import AccessDenied from '@/pages/AccessDenied';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, isAdmin, loading } = useAuth();

  console.log('[ProtectedRoute] Render:', { 
    userEmail: user?.email, 
    userId: user?.id,
    isAdmin, 
    loading, 
    requireAdmin,
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

  // Check 1: User must be logged in
  if (!user) {
    console.log('[ProtectedRoute] ❌ No user - Access Denied');
    return <AccessDenied />;
  }

  // Check 2: If admin is required, verify admin status
  if (requireAdmin && !isAdmin) {
    console.log('[ProtectedRoute] ❌ Admin required but user is not admin - Access Denied');
    return <AccessDenied />;
  }

  console.log('[ProtectedRoute] ✅ Access granted');
  return <>{children}</>;
}
