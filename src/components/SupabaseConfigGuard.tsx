import { ReactNode } from 'react';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/client';

interface SupabaseConfigGuardProps {
  children: ReactNode;
}

/**
 * Runtime guard to ensure Supabase configuration is valid.
 * Since we now use hardcoded credentials pointing to the production project,
 * this guard simply validates the constants are present.
 */
export function SupabaseConfigGuard({ children }: SupabaseConfigGuardProps) {
  const url = SUPABASE_URL;
  const key = SUPABASE_ANON_KEY;

  const maskedUrl = url ? `${url.substring(0, 20)}...` : 'MISSING';
  const maskedKey = key ? `${key.substring(0, 10)}...` : 'MISSING';
  console.log('[SupabaseGuard] Config check:', { url: maskedUrl, key: maskedKey });

  const isUrlValid = url && typeof url === 'string' && url.startsWith('https://');
  const isKeyValid = key && typeof key === 'string' && key.length > 20;

  if (!isUrlValid || !isKeyValid) {
    console.error('[SupabaseGuard] Invalid Supabase configuration:', {
      urlValid: isUrlValid,
      keyValid: isKeyValid,
    });

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-destructive/10 via-background to-background p-4">
        <p className="text-destructive">Configuration error. Please contact support.</p>
      </div>
    );
  }

  return <>{children}</>;
}
