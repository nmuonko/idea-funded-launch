import { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

interface SupabaseConfigGuardProps {
  children: ReactNode;
}

/**
 * Runtime guard to ensure Supabase configuration is valid.
 * Shows a blocking error screen if VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY are missing/invalid.
 */
export function SupabaseConfigGuard({ children }: SupabaseConfigGuardProps) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  // Log masked config for debugging
  const maskedUrl = url ? `${url.substring(0, 20)}...` : 'MISSING';
  const maskedKey = key ? `${key.substring(0, 10)}...` : 'MISSING';
  console.log('[SupabaseGuard] Config check:', { url: maskedUrl, key: maskedKey });

  const isUrlValid = url && typeof url === 'string' && url.startsWith('https://');
  const isKeyValid = key && typeof key === 'string' && key.length > 20;

  if (!isUrlValid || !isKeyValid) {
    console.error('[SupabaseGuard] Invalid Supabase configuration:', {
      urlValid: isUrlValid,
      keyValid: isKeyValid,
      urlProvided: !!url,
      keyProvided: !!key,
    });

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-destructive/10 via-background to-background p-4">
        <Card className="max-w-md w-full bg-card/90 backdrop-blur border-destructive/30 shadow-2xl">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-xl text-foreground">Configuration Error</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground">
              Supabase configuration is missing or invalid.
            </p>
            <div className="bg-muted/50 rounded-lg p-3 text-left text-sm font-mono">
              <p className={!isUrlValid ? 'text-destructive' : 'text-muted-foreground'}>
                VITE_SUPABASE_URL: {isUrlValid ? '✓' : '✗ Missing or invalid'}
              </p>
              <p className={!isKeyValid ? 'text-destructive' : 'text-muted-foreground'}>
                VITE_SUPABASE_PUBLISHABLE_KEY: {isKeyValid ? '✓' : '✗ Missing or invalid'}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Please ensure these environment variables are correctly set in your deployment.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
