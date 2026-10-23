import { supabase } from '@/integrations/supabase/client';

interface PublishResult { ok?: boolean; message?: string; error?: string }

// Retry only authentication failures: replaying other failed mutations is unsafe.
export async function vipPublishRequest(body: Record<string, unknown>): Promise<void> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) throw new Error('Your session has expired. Please sign in again.');

  const invoke = (token: string) => supabase.functions.invoke<PublishResult>('vip-publish', {
    body, headers: { Authorization: `Bearer ${token}` },
  });
  let result = await invoke(session.access_token);
  const response = result.error?.context;
  if (response instanceof Response && response.status === 401) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) throw new Error('Your session has expired. Please sign in again.');
    result = await invoke(data.session.access_token);
  }

  let details = result.data;
  if (result.error?.context instanceof Response) {
    details = await result.error.context.clone().json().catch(() => null) as PublishResult | null;
  }
  if (result.error || !details?.ok) {
    const status = result.error?.context instanceof Response ? result.error.context.status : undefined;
    if (status === 401) throw new Error('Your session has expired. Please sign in again.');
    if (status === 403) throw new Error('Your account does not have permission to update VIP products.');
    throw new Error(details?.message || details?.error || result.error?.message || 'Unable to update this product. Please try again.');
  }
}