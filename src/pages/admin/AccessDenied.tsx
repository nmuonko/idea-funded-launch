import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, ArrowLeft, Mail } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { PERMISSION_LABELS, SectionPermissions } from '@/hooks/useAdminPermissions';

export default function AdminAccessDenied() {
  const location = useLocation();
  const missingPermission = location.state?.missingPermission as keyof SectionPermissions | undefined;
  const attemptedPath = location.state?.attemptedPath as string | undefined;

  const permissionInfo = missingPermission ? PERMISSION_LABELS[missingPermission] : null;

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-full bg-destructive/10">
              <ShieldAlert className="h-12 w-12 text-destructive" />
            </div>
          </div>
          <CardTitle className="text-2xl">Access Denied</CardTitle>
          <CardDescription className="text-base">
            You don't have permission to access this section of the admin portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {permissionInfo && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Missing Permission:</p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-destructive border-destructive">
                  {permissionInfo.label}
                </Badge>
                <span className="text-sm text-muted-foreground">({permissionInfo.category})</span>
              </div>
              {attemptedPath && (
                <p className="text-xs text-muted-foreground mt-2">
                  Attempted to access: <code className="bg-muted px-1 rounded">{attemptedPath}</code>
                </p>
              )}
            </div>
          )}

          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium">How to get access:</p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Contact your Super Admin</li>
              <li>Request access to the <strong>{permissionInfo?.label || 'required'}</strong> section</li>
              <li>Once granted, refresh the page to see the changes</li>
            </ol>
          </div>

          <div className="flex flex-col gap-3 pt-2">
            <Button asChild variant="default">
              <Link to="/admin">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Return to Dashboard
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a href="mailto:admin@afrishop.com?subject=Permission Request&body=I would like to request access to the admin portal section: ">
                <Mail className="h-4 w-4 mr-2" />
                Email Super Admin
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
