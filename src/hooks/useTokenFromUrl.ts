import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook that checks URL params for:
 * 1. `handoff` — a one-time DB-backed token from mobile-checkout-bridge
 * 2. `access_token` / `token` — direct JWT fallback
 *
 * For handoff tokens: validates via checkout-handoff-validate, then uses
 * the accompanying access_token to bootstrap a Supabase session.
 *
 * Returns:
 * - bootstrapping: true while attempting to set session from URL token
 * - bootstrapped: true after a successful session was established
 */
export function useTokenFromUrl() {
  const [bootstrapping, setBootstrapping] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    return !!(
      params.get('handoff') ||
      params.get('token') ||
      params.get('access_token') ||
      hashParams.get('token') ||
      hashParams.get('access_token')
    );
  });
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));

      const handoffToken = params.get('handoff');
      const accessToken =
        params.get('access_token') ||
        params.get('token') ||
        hashParams.get('access_token') ||
        hashParams.get('token');
      const refreshToken =
        params.get('refresh_token') || hashParams.get('refresh_token') || '';

      // Nothing to bootstrap
      if (!handoffToken && !accessToken) {
        setBootstrapping(false);
        return;
      }

      // --- Path A: Handoff token (preferred, DB-backed, single-use) ---
      if (handoffToken) {
        console.log('[TokenFromUrl] Found handoff token, validating…');
        try {
          const { data, error } = await supabase.functions.invoke(
            'checkout-handoff-validate',
            { body: { handoff: handoffToken } },
          );

          if (error || !data?.ok) {
            const errCode = data?.error_code || data?.error || 'UNKNOWN';
            console.warn('[TokenFromUrl] Handoff validation failed:', errCode, data?.message);
            // Fall through to access_token fallback if available
          } else {
            console.log(
              '[TokenFromUrl] ✅ Handoff validated for:',
              data.email,
              'handoff_id:',
              data.handoff_id,
            );
          }
        } catch (err) {
          console.error('[TokenFromUrl] Handoff validation exception:', err);
        }

        // Whether handoff succeeded or not, try to bootstrap session with the
        // access_token that mobile-checkout-bridge also embeds in the URL
        if (accessToken) {
          try {
            const { data: sessionData, error: sessionErr } =
              await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
            if (sessionErr) {
              console.error('[TokenFromUrl] setSession failed:', sessionErr.message);
            } else if (sessionData.session) {
              console.log(
                '[TokenFromUrl] ✅ Session bootstrapped from handoff URL for:',
                sessionData.session.user?.email,
              );
              setBootstrapped(true);
              sessionStorage.setItem('sessionActive', 'true');
            }
          } catch (err) {
            console.error('[TokenFromUrl] setSession exception:', err);
          }
        }
      } else if (accessToken) {
        // --- Path B: Direct JWT (legacy / fallback) ---
        console.log('[TokenFromUrl] Found access_token in URL, bootstrapping session…');
        try {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            console.error('[TokenFromUrl] Failed to set session:', error.message);
          } else if (data.session) {
            console.log(
              '[TokenFromUrl] ✅ Session bootstrapped from URL token for:',
              data.session.user?.email,
            );
            setBootstrapped(true);
            sessionStorage.setItem('sessionActive', 'true');
          }
        } catch (err) {
          console.error('[TokenFromUrl] Exception:', err);
        }
      }

      // Clean tokens from URL for security
      const url = new URL(window.location.href);
      url.searchParams.delete('handoff');
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
