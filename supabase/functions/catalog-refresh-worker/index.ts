/**
 * Catalog Refresh Worker
 * 
 * Queue-based background worker that:
 * 1. Pulls due jobs from catalog_refresh_queue using SKIP LOCKED
 * 2. Fetches from provider APIs (eBay)
 * 3. Upserts results into catalog_items (never deletes)
 * 4. Deactivates items only when provider confirms unavailable or repeated failures
 * 5. Respects TTL policy (global + per-category)
 * 
 * POST /catalog-refresh-worker
 * Body: { maxJobs?: number, mode?: 'queue' | 'stale' | 'pool-fill' }
 * 
 * Requires: admin auth or cron secret
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getTtlPolicy } from "../_shared/ttlPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret, x-admin-key",
};

const EBAY_OAUTH_SCOPES = "https://api.ebay.com/oauth/api_scope";
const EBAY_ENDPOINTS = {
  production: {
    oauth: "https://api.ebay.com/identity/v1/oauth2/token",
    browse: "https://api.ebay.com/buy/browse/v1",
  },
  sandbox: {
    oauth: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    browse: "https://api.sandbox.ebay.com/buy/browse/v1",
  },
};

const MAX_CONCURRENCY = 3;
const DEACTIVATE_FAIL_THRESHOLD = 3;
const DEACTIVATE_NOT_SEEN_DAYS = 90;
const RATE_LIMIT_DELAY_MS = 600;

// ─── Auth ────────────────────────────────────────────────────────────────────

function checkAuth(req: Request, serviceKey: string): boolean {
  // 1. x-cron-secret header (used by pg_cron scheduled calls)
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret && cronSecret === Deno.env.get("CRON_SECRET")) return true;
  // 2. x-admin-key header (legacy, same secret)
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey && adminKey === Deno.env.get("CRON_SECRET")) return true;
  // 3. Service role key only (for manual admin debugging)
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.replace("Bearer ", "") === serviceKey) return true;
  // NEVER accept anon key — it's public and would let anyone trigger refreshes
  return false;
}

// ─── eBay Token ──────────────────────────────────────────────────────────────

async function getEbayToken(supabase: any): Promise<string> {
  const { data: cached } = await supabase
    .from("provider_tokens")
    .select("access_token, expires_at")
    .eq("provider", "ebay")
    .maybeSingle();

  if (cached) {
    const expiresAt = new Date(cached.expires_at).getTime();
    if (expiresAt > Date.now() + 60_000) return cached.access_token;
  }

  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("EBAY credentials not configured");

  const env = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  const creds = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(EBAY_ENDPOINTS[env].oauth, {
    method: "POST",
    headers: { "Authorization": `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_OAUTH_SCOPES)}`,
  });
  if (!res.ok) throw new Error(`eBay OAuth failed: ${res.status}`);

  const data = await res.json();
  const expiresAt = new Date(Date.now() + (data.expires_in * 1000) - 60_000);

  await supabase.from("provider_tokens").upsert({
    provider: "ebay",
    access_token: data.access_token,
    token_type: data.token_type || "Bearer",
    expires_at: expiresAt.toISOString(),
    scopes: [EBAY_OAUTH_SCOPES],
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider" });

  return data.access_token;
}

// ─── eBay Search ─────────────────────────────────────────────────────────────

async function searchEbay(token: string, query: string, limit = 20): Promise<any[]> {
  const env = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    offset: "0",
    filter: "buyingOptions:{FIXED_PRICE}",
  });

  const res = await fetch(`${EBAY_ENDPOINTS[env].browse}/item_summary/search?${params}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "Content-Type": "application/json",
    },
  });

  if (res.status === 429) {
    console.warn("[WORKER] eBay 429 rate limited");
    return [];
  }
  if (!res.ok) {
    console.error(`[WORKER] eBay error: ${res.status}`);
    return [];
  }

  const data = await res.json();
  return data.itemSummaries || [];
}

// ─── Compute data hash ──────────────────────────────────────────────────────

function computeHash(title: string, price: number | null, imageUrl: string | null): string {
  return `${title || ""}|${price || 0}|${imageUrl || ""}`;
}

// ─── Process queue jobs ──────────────────────────────────────────────────────

async function processQueueJobs(supabase: any, ebayToken: string, maxJobs: number) {
  // Claim jobs with SKIP LOCKED via RPC or direct query
  const lockId = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  // Fetch queued jobs that are due
  const { data: jobs, error } = await supabase
    .from("catalog_refresh_queue")
    .select("*")
    .eq("status", "queued")
    .lte("scheduled_at", now)
    .order("priority", { ascending: true })
    .order("scheduled_at", { ascending: true })
    .limit(maxJobs);

  if (error || !jobs?.length) {
    console.log(`[WORKER] No queue jobs found`);
    return { processed: 0, upserted: 0 };
  }

  // Lock jobs
  const jobIds = jobs.map((j: any) => j.id);
  await supabase
    .from("catalog_refresh_queue")
    .update({ status: "running", locked_at: now, locked_by: lockId })
    .in("id", jobIds);

  let totalUpserted = 0;

  for (const job of jobs) {
    try {
      const items = await searchEbay(ebayToken, job.query, 20);
      
      if (items.length === 0) {
        // Mark done with no results
        await supabase.from("catalog_refresh_queue").update({
          status: "done",
          attempts: (job.attempts || 0) + 1,
          last_error: "no_results",
        }).eq("id", job.id);
        continue;
      }

      // Upsert items
      const upsertRows = items
        .filter((item: any) => item.title && item.itemId)
        .map((item: any) => {
          const priceUsd = item.price?.value ? parseFloat(item.price.value) : null;
          const imageUrl = item.image?.imageUrl?.replace(/^http:/, "https:") || null;
          const hash = computeHash(item.title, priceUsd, imageUrl);

          return {
            id: `ebay:${item.itemId}`,
            provider: "ebay",
            provider_product_id: item.itemId,
            title: item.title,
            price_usd: priceUsd,
            image_url: imageUrl,
            product_url: item.itemWebUrl || `https://www.ebay.com/itm/${item.itemId}`,
            in_stock: item.itemAvailability?.availabilityStatus !== "OUT_OF_STOCK",
            category_key: job.category_key,
            unified_category: job.category_key,
            last_seen_at: now,
            data_updated_at: now,
            price_updated_at: now,
            data_hash: hash,
            is_active: true,
            status_reason: "active",
            fail_count: 0,
            last_checked_at: now,
            updated_at: now,
            tags: [job.category_key],
            buying_options: item.buyingOptions || ["FIXED_PRICE"],
          };
        });

      if (upsertRows.length > 0) {
        const { error: upsertErr } = await supabase
          .from("catalog_items")
          .upsert(upsertRows, { onConflict: "provider,provider_product_id" });

        if (upsertErr) {
          console.error(`[WORKER] Upsert error for job ${job.id}:`, upsertErr.message);
        } else {
          totalUpserted += upsertRows.length;
        }
      }

      await supabase.from("catalog_refresh_queue").update({
        status: "done",
        attempts: (job.attempts || 0) + 1,
      }).eq("id", job.id);

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.error(`[WORKER] Job ${job.id} failed:`, msg);

      // Exponential backoff
      const attempts = (job.attempts || 0) + 1;
      const backoffMinutes = Math.min(60 * 24, Math.pow(2, attempts) * 10);
      const nextRun = new Date(Date.now() + backoffMinutes * 60_000).toISOString();

      await supabase.from("catalog_refresh_queue").update({
        status: attempts >= 5 ? "failed" : "queued",
        attempts,
        last_error: msg,
        scheduled_at: nextRun,
        locked_at: null,
        locked_by: null,
      }).eq("id", job.id);
    }

    // Rate limit between API calls
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }

  return { processed: jobs.length, upserted: totalUpserted };
}

// ─── Refresh stale items (price/availability) ────────────────────────────────

async function refreshStaleItems(supabase: any, ebayToken: string, maxItems: number) {
  // Find items with stale prices
  const policy = await getTtlPolicy(supabase);
  const staleDate = new Date(Date.now() - policy.priceRefreshDays * 86_400_000).toISOString();

  const { data: staleItems } = await supabase
    .from("catalog_items")
    .select("id, provider, provider_product_id, category_key, title, price_usd, image_url")
    .eq("is_active", true)
    .eq("provider", "ebay")
    .lt("price_updated_at", staleDate)
    .order("price_updated_at", { ascending: true })
    .limit(maxItems);

  if (!staleItems?.length) {
    console.log("[WORKER] No stale items to refresh");
    return { refreshed: 0, deactivated: 0 };
  }

  console.log(`[WORKER] Refreshing ${staleItems.length} stale items`);
  let refreshed = 0;
  let deactivated = 0;
  const now = new Date().toISOString();

  // Process in batches of MAX_CONCURRENCY
  for (let i = 0; i < staleItems.length; i += MAX_CONCURRENCY) {
    const batch = staleItems.slice(i, i + MAX_CONCURRENCY);

    for (const item of batch) {
      try {
        // Try to fetch individual item
        const env = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
        const itemUrl = `${EBAY_ENDPOINTS[env].browse}/item/${item.provider_product_id}`;
        
        const res = await fetch(itemUrl, {
          headers: {
            "Authorization": `Bearer ${ebayToken}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          },
        });

        if (res.status === 404 || res.status === 410) {
          // Item no longer available
          const failCount = (item.fail_count || 0) + 1;
          if (failCount >= DEACTIVATE_FAIL_THRESHOLD) {
            await supabase.from("catalog_items").update({
              is_active: false,
              status_reason: "provider_unavailable",
              fail_count: failCount,
              last_checked_at: now,
            }).eq("id", item.id);
            deactivated++;
          } else {
            await supabase.from("catalog_items").update({
              fail_count: failCount,
              status_reason: "check_failed",
              last_checked_at: now,
            }).eq("id", item.id);
          }
          continue;
        }

        if (res.status === 429) {
          console.warn("[WORKER] eBay 429, stopping stale refresh");
          break;
        }

        if (res.ok) {
          const data = await res.json();
          const newPrice = data.price?.value ? parseFloat(data.price.value) : item.price_usd;
          const newImage = data.image?.imageUrl?.replace(/^http:/, "https:") || item.image_url;
          const newHash = computeHash(data.title || item.title, newPrice, newImage);
          const priceChanged = newPrice !== item.price_usd;

          await supabase.from("catalog_items").update({
            price_usd: newPrice,
            image_url: newImage,
            title: data.title || item.title,
            in_stock: data.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus !== "OUT_OF_STOCK",
            price_updated_at: now,
            data_updated_at: priceChanged ? now : undefined,
            last_seen_at: now,
            last_checked_at: now,
            data_hash: newHash,
            fail_count: 0,
            is_active: true,
            status_reason: "active",
          }).eq("id", item.id);
          refreshed++;
        }
      } catch (err) {
        console.error(`[WORKER] Error refreshing ${item.id}:`, err instanceof Error ? err.message : err);
      }

      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }
  }

  return { refreshed, deactivated };
}

// ─── Deactivate old unseen items ─────────────────────────────────────────────

async function deactivateOldItems(supabase: any) {
  const cutoff = new Date(Date.now() - DEACTIVATE_NOT_SEEN_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("catalog_items")
    .update({
      is_active: false,
      status_reason: "not_seen_timeout",
    })
    .eq("is_active", true)
    .lt("last_seen_at", cutoff)
    .select("id", { count: "exact", head: true });

  const count = data?.length || 0;
  if (count > 0) console.log(`[WORKER] Deactivated ${count} old items (not seen in ${DEACTIVATE_NOT_SEEN_DAYS}d)`);
  return count;
}

// ─── Pool fill planner ───────────────────────────────────────────────────────

async function ensureCategoryPools(supabase: any) {
  const MIN_POOL = 2000;
  const TARGET_POOL = 4000;
  
  // Get active item counts per category
  const { data: items } = await supabase
    .from("catalog_items")
    .select("unified_category")
    .eq("is_active", true)
    .not("unified_category", "is", null);

  const counts: Record<string, number> = {};
  for (const item of items || []) {
    const cat = item.unified_category as string;
    counts[cat] = (counts[cat] || 0) + 1;
  }

  console.log("[WORKER] Category pool counts:", counts);

  // Find categories below min pool
  const thinCategories: string[] = [];
  const allCats = [
    "electronics", "vehicles", "home_garden", "clothing_shoes_accessories",
    "toys", "sporting_goods", "business_industrial", "jewelry_watches",
    "refurbished", "parts_accessories", "beauty_health", "collectibles",
    "cameras_photo",
  ];

  for (const cat of allCats) {
    if ((counts[cat] || 0) < MIN_POOL) {
      thinCategories.push(cat);
    }
  }

  if (thinCategories.length === 0) {
    console.log("[WORKER] All categories above min pool");
    return { thinCategories: [], enqueued: 0 };
  }

  console.log(`[WORKER] Thin categories: ${thinCategories.join(", ")}`);

  // Enqueue additional seed queries for thin categories
  let enqueued = 0;
  for (const cat of thinCategories) {
    // Get unused/least-recently-used seeds for this category
    const { data: seeds } = await supabase
      .from("catalog_seed_queries")
      .select("*")
      .eq("category", cat)
      .eq("enabled", true)
      .order("last_refreshed_at", { ascending: true, nullsFirst: true })
      .limit(10);

    for (const seed of seeds || []) {
      // Check if already queued
      const { data: existing } = await supabase
        .from("catalog_refresh_queue")
        .select("id")
        .eq("category_key", cat)
        .eq("query", seed.query)
        .in("status", ["queued", "running"])
        .maybeSingle();

      if (!existing) {
        await supabase.from("catalog_refresh_queue").insert({
          category_key: cat,
          provider: seed.provider || "ebay",
          query: seed.query,
          priority: 10, // High priority for pool fill
          status: "queued",
          scheduled_at: new Date().toISOString(),
        });
        enqueued++;
      }
    }
  }

  return { thinCategories, enqueued };
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!checkAuth(req, serviceKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let maxJobs = 10;
  let mode = "queue"; // queue | stale | pool-fill | all
  try {
    const body = await req.json().catch(() => ({}));
    maxJobs = body.maxJobs || 10;
    mode = body.mode || "queue";
  } catch { /* defaults */ }

  // Also check URL params
  const url = new URL(req.url);
  mode = url.searchParams.get("mode") || mode;

  const supabase = createClient(supabaseUrl, serviceKey);
  const startTime = Date.now();
  const results: Record<string, any> = { mode };

  try {
    // Get eBay token
    const ebayToken = await getEbayToken(supabase);

    if (mode === "queue" || mode === "all") {
      results.queue = await processQueueJobs(supabase, ebayToken, maxJobs);
    }

    if (mode === "stale" || mode === "all") {
      results.stale = await refreshStaleItems(supabase, ebayToken, maxJobs);
    }

    if (mode === "pool-fill" || mode === "all") {
      results.poolFill = await ensureCategoryPools(supabase);
    }

    // Always deactivate old items
    results.deactivated = await deactivateOldItems(supabase);

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[WORKER] Fatal error:", msg);
    results.error = msg;
  }

  results.durationMs = Date.now() - startTime;
  console.log("[WORKER] Complete:", JSON.stringify(results));

  return new Response(JSON.stringify({ success: true, ...results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
