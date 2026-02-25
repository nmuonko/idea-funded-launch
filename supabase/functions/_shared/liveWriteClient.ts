/**
 * Live Write Client
 * 
 * Returns a Supabase client that ALWAYS writes to the Live database.
 * - If LIVE_SUPABASE_URL + LIVE_SUPABASE_SERVICE_ROLE_KEY are set (Test env), uses those.
 * - Otherwise falls back to SUPABASE_URL (we ARE the Live env).
 * 
 * Use this for all catalog_items upserts so data always goes to Live.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

let _liveClient: ReturnType<typeof createClient> | null = null;

export function getLiveWriteClient(): ReturnType<typeof createClient> {
  if (_liveClient) return _liveClient;

  const liveUrl = Deno.env.get("LIVE_SUPABASE_URL");
  const liveKey = Deno.env.get("LIVE_SUPABASE_SERVICE_ROLE_KEY");

  if (liveUrl && liveKey) {
    console.log("[LIVE_WRITE] Using LIVE_SUPABASE_URL for catalog writes");
    _liveClient = createClient(liveUrl, liveKey);
  } else {
    // Fallback: we ARE the live environment
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    console.log("[LIVE_WRITE] No LIVE_SUPABASE_URL set, using local env (assumed Live)");
    _liveClient = createClient(url, key);
  }

  return _liveClient;
}
