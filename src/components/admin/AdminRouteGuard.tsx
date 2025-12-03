import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAdminPermissions, SectionPermissions } from '@/hooks/useAdminPermissions';
import { Loader2 } from 'lucide-react';

interface AdminRouteGuardProps {
  children: React.ReactNode;
  requiredPermission?: keyof SectionPermissions;
}

export function AdminRouteGuard({ children, requiredPermission }: AdminRouteGuardProps) {
  const { permissions, loading } = useAdminPermissions();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;
    
    // If no specific permission required, allow access
    if (!requiredPermission) return;
    
    // Super admin always has access
    if (permissions?.isSuperAdmin) return;
    
    // Check specific permission
    if (permissions && !permissions[requiredPermission]) {
      navigate('/admin/access-denied', { 
        replace: true,
        state: { 
          missingPermission: requiredPermission,
          attemptedPath: location.pathname 
        }
      });
    }
  }, [loading, permissions, requiredPermission, navigate, location.pathname]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No permission required or super admin
  if (!requiredPermission || permissions?.isSuperAdmin) {
    return <>{children}</>;
  }

  // Check permission
  if (permissions && permissions[requiredPermission]) {
    return <>{children}</>;
  }

  // Will redirect via useEffect, show nothing
  return null;
}
