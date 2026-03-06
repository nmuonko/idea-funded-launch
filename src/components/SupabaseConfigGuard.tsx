import { ReactNode } from 'react';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

interface SupabaseConfigGuardProps {
  children: ReactNode;
}

/**
 * Runtime guard — validates Supabase env vars are present.
 */
export function SupabaseConfigGuard({ children }: SupabaseConfigGuardProps) {
  const isUrlValid = SUPABASE_URL && typeof SUPABASE_URL === 'string' && SUPABASE_URL.startsWith('https://');
  const isKeyValid = SUPABASE_ANON_KEY && typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY.length > 20;

  if (!isUrlValid || !isKeyValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-destructive/10 via-background to-background p-4">
        <p className="text-destructive">Configuration error. Please contact support.</p>
      </div>
    );
  }

  return <>{children}</>;
}
