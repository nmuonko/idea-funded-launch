import { useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

const REF_STORAGE_KEY = 'afrishop_ref_code';
const REF_CLICK_SESSION_KEY = 'afrishop_ref_click_sent';

function getQueryParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/**
 * /get is now a referral landing redirect.
 * Shared referral links (e.g. /get?ref=XXXX) should land users directly on
 * /hot-products. We still persist the ref code in localStorage and log the
 * click before redirecting, so attribution is preserved.
 */
export default function GetApp() {
  const params = useMemo(() => getQueryParams(), []);
  const refCode = params.get('ref');

  // Store ref code in localStorage for 30 days
  useEffect(() => {
    if (!refCode) return;
    const data = { code: refCode, expires: Date.now() + 30 * 24 * 60 * 60 * 1000 };
    try {
      localStorage.setItem(REF_STORAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }, [refCode]);

  // Track referral click (dedupe per session, validate ref_code)
  useEffect(() => {
    if (!refCode) return;
    const sessionKey = `${REF_CLICK_SESSION_KEY}_${refCode}`;
    if (sessionStorage.getItem(sessionKey)) return;

    const anonSessionId = crypto.randomUUID();
    supabase
      .rpc('validate_ref_code', { code: refCode })
      .maybeSingle()
      .then(({ data: referrer }: { data: any }) => {
        if (!referrer || referrer.status !== 'active') return;
        supabase.from('referral_events').insert({
          ref_code: refCode,
          event_type: 'click',
          anon_session_id: anonSessionId,
          meta: {
            user_agent: navigator.userAgent,
            referrer: document.referrer || null,
            utm_source: params.get('utm_source'),
            utm_medium: params.get('utm_medium'),
            utm_campaign: params.get('utm_campaign'),
          },
        }).then(() => {
          try { sessionStorage.setItem(sessionKey, '1'); } catch { /* ignore */ }
        });
      });
  }, [refCode, params]);

  // Forward all relevant query params to /hot-products
  const relevantKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'];
  const forwarded = new URLSearchParams();
  relevantKeys.forEach((k) => {
    const v = params.get(k);
    if (v) forwarded.set(k, v);
  });
  const qs = forwarded.toString();
  const target = qs ? `/hot-products?${qs}` : '/hot-products';

  return <Navigate to={target} replace />;
}
