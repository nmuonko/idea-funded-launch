import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook that checks URL params for auth tokens (access_token, refresh_token, token)
 * and bootstraps a Supabase session from them. This enables the frozen RN app
 * to open WebView checkout URLs with embedded auth credentials.
 * 
 * Returns:
 * - bootstrapping: true while attempting to set session from URL token
 * - bootstrapped: true after a successful session was established from URL
 */
export function useTokenFromUrl() {
  const [bootstrapping, setBootstrapping] = useState(() => {
    // Synchronous check: are there token params in the URL right now?
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return !!(params.get('token') || params.get('access_token'));
  });
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    const run = async () => {
      // Check both query params and hash fragment (some auth flows use #access_token=...)
      const params = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = params.get('access_token') || params.get('token') 
        || hashParams.get('access_token') || hashParams.get('token');
      const refreshToken = params.get('refresh_token') || hashParams.get('refresh_token') || '';

      if (!accessToken) {
        setBootstrapping(false);
        return;
      }

      console.log('[TokenFromUrl] Found token in URL, bootstrapping session...');

      try {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          console.error('[TokenFromUrl] Failed to set session:', error.message);
        } else if (data.session) {
          console.log('[TokenFromUrl] ✅ Session bootstrapped from URL token for:', data.session.user?.email);
          setBootstrapped(true);
          // Set flags so AuthContext doesn't skip the session
          sessionStorage.setItem('sessionActive', 'true');
        }
      } catch (err) {
        console.error('[TokenFromUrl] Exception:', err);
      }

      // Clean tokens from URL for security (replace without reload)
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      url.searchParams.delete('access_token');
      url.searchParams.delete('refresh_token');
      window.history.replaceState({}, '', url.toString());

      setBootstrapping(false);
    };

    run();
  }, []);

  return { bootstrapping, bootstrapped };
}
