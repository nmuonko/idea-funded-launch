import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Detects handoff or access_token in URL, validates handoff via backend,
 * and bootstraps a Supabase session for WebView checkout.
 *
 * Checkpoint logs (for debugging with Replit):
 *   [TokenFromUrl] handoff-detected
 *   [TokenFromUrl] handoff-validate-ok / handoff-validate-fail
 *   [TokenFromUrl] session-bootstrap-ok / session-bootstrap-fail
 *   [TokenFromUrl] no-token-in-url
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

      if (!handoffToken && !accessToken) {
        console.log('[TokenFromUrl] no-token-in-url');
        setBootstrapping(false);
        return;
      }

      // ── Path A: Handoff token (DB-backed, single-use) ──
      if (handoffToken) {
        console.log('[TokenFromUrl] handoff-detected tokenPrefix=' + handoffToken.slice(0, 8) + '…');

        // Step 1: Validate handoff with backend
        let handoffValid = false;
        try {
          const { data, error } = await supabase.functions.invoke(
            'checkout-handoff-validate',
            { body: { handoff: handoffToken } },
          );

          if (error || !data?.ok) {
            const errCode = data?.error_code || data?.error || 'UNKNOWN';
            console.warn('[TokenFromUrl] handoff-validate-fail code=' + errCode, data?.message);
          } else {
            handoffValid = true;
            console.log('[TokenFromUrl] handoff-validate-ok handoffId=' + data.handoff_id + ' email=' + data.email);
          }
        } catch (err) {
          console.error('[TokenFromUrl] handoff-validate-exception', err);
        }

        // Step 2: Bootstrap session from the access_token embedded in the URL
        if (accessToken) {
          try {
            const { data: sessionData, error: sessionErr } =
              await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
            if (sessionErr) {
              console.error('[TokenFromUrl] session-bootstrap-fail', sessionErr.message);
            } else if (sessionData.session) {
              console.log('[TokenFromUrl] session-bootstrap-ok email=' + sessionData.session.user?.email + ' handoffValid=' + handoffValid);
              setBootstrapped(true);
              sessionStorage.setItem('sessionActive', 'true');
            } else {
              console.warn('[TokenFromUrl] session-bootstrap-fail no-session-returned');
            }
          } catch (err) {
            console.error('[TokenFromUrl] session-bootstrap-exception', err);
          }
        } else {
          console.warn('[TokenFromUrl] handoff-present-but-no-access-token — cannot bootstrap session');
        }
      } else if (accessToken) {
        // ── Path B: Direct JWT (legacy fallback) ──
        console.log('[TokenFromUrl] access-token-detected (no handoff)');
        try {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            console.error('[TokenFromUrl] session-bootstrap-fail', error.message);
          } else if (data.session) {
            console.log('[TokenFromUrl] session-bootstrap-ok email=' + data.session.user?.email);
            setBootstrapped(true);
            sessionStorage.setItem('sessionActive', 'true');
          }
        } catch (err) {
          console.error('[TokenFromUrl] session-bootstrap-exception', err);
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
