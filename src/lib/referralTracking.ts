/**
 * Referral funnel tracking.
 *
 * When a visitor lands on a /get?ref=XXXX or /hot-products?ref=XXXX link, the
 * GetApp page stores the ref code in localStorage under `afrishop_ref_code`
 * for 30 days. We use that same code here to attribute downstream funnel
 * events (add_to_cart, payment_initiated) to the referrer so admins can see
 * conversion per shared link.
 *
 * `purchase` events are inserted server-side by
 * supabase/functions/_shared/referralCommission.ts when an order is paid.
 */
import { supabase } from '@/integrations/supabase/client';

const REF_STORAGE_KEY = 'afrishop_ref_code';

export type ReferralFunnelEvent = 'add_to_cart' | 'payment_initiated';

interface StoredRef {
  code: string;
  expires: number;
}

function getStoredRefCode(): string | null {
  try {
    const raw = localStorage.getItem(REF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRef;
    if (!parsed?.code) return null;
    if (parsed.expires && parsed.expires < Date.now()) {
      localStorage.removeItem(REF_STORAGE_KEY);
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}

function getAnonSessionId(): string {
  try {
    let s = sessionStorage.getItem('afrishop_ref_session_id');
    if (!s) {
      s = crypto.randomUUID();
      sessionStorage.setItem('afrishop_ref_session_id', s);
    }
    return s;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Fire-and-forget: log a referral funnel event for the active ref code (if any).
 * No-op when there's no stored ref code. Never throws.
 */
export async function trackReferralFunnelEvent(
  event: ReferralFunnelEvent,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const code = getStoredRefCode();
  if (!code) return;

  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id ?? null;
    await supabase.from('referral_events').insert({
      ref_code: code,
      event_type: event,
      anon_session_id: getAnonSessionId(),
      user_id: userId,
      meta: {
        ...meta,
        path: typeof window !== 'undefined' ? window.location.pathname : null,
      },
    });
  } catch (err) {
    // Never block the user flow on tracking errors.
    console.warn('[REFERRAL_TRACK] insert failed', err);
  }
}
