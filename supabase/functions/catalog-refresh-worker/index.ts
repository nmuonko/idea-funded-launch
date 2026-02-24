/**
 * Catalog Refresh Worker
 * 
 * Queue-based background worker that:
 * 1. Pulls due jobs from catalog_refresh_queue using SKIP LOCKED
 * 2. Fetches from provider APIs (eBay)
 * 3. Upserts results into catalog_items (never deletes)
 * 4. Deactivates items only when provider confirms unavailable or repeated failures
 * 5. Respects TTL policy (global + per-category)
 * 6. NEW: mode=catalog-builder for aggressive bulk indexing
 * 
 * POST /catalog-refresh-worker
 * Body: { maxJobs?: number, mode?: 'queue' | 'stale' | 'pool-fill' | 'catalog-builder' }
 * 
 * Requires: admin auth or cron secret
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getTtlPolicy } from "../_shared/ttlPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret, x-admin-key, x-internal-cron-key",
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
const SEED_BACKFILL_BATCH = 25;
const SEED_BACKFILL_DELAY_MS = 800;

// Builder constants — Guardrail 3: cap derived from time budget
const BUILDER_TIME_BUDGET_MS = 45_000;
const BUILDER_DELAY_MS = 1_000;
const BUILDER_RESERVE_MS = 3_000; // stop cleanly when < 3s remaining
const BUILDER_AVG_API_MS = 400; // estimated average eBay API latency
// Guardrail 4: dynamic max requests = floor((budget - reserve) / (delay + avgApiMs))
const BUILDER_MAX_REQUESTS_PER_RUN = Math.min(
  40,
  Math.max(5, Math.floor((BUILDER_TIME_BUDGET_MS - BUILDER_RESERVE_MS) / (BUILDER_DELAY_MS + BUILDER_AVG_API_MS)))
); // ~30 with defaults
const BUILDER_ITEMS_PER_PAGE = 100;
const BUILDER_PAGES_PER_SOURCE = 3;
const BUILDER_EXHAUSTION_COOLDOWN_DAYS = 7; // Guardrail 7: temporary exhaustion
const BUILDER_CONSECUTIVE_ZERO_THRESHOLD = 5; // Only exhaust after 5 consecutive pages with 0 new items
const BUILDER_OFFSET_JUMP = 500; // Jump forward when duplicates are high instead of exhausting
const BUILDER_SORT_MODES = ["newlyListed", "endingSoonest", "price"] as const;

// ─── Auth ────────────────────────────────────────────────────────────────────

function checkAuth(req: Request, serviceKey: string): boolean {
  const cronSecret = req.headers.get("x-cron-secret");
  const envCronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && envCronSecret && cronSecret === envCronSecret) return true;
  if (cronSecret && cronSecret === serviceKey) return true;
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey && envCronSecret && adminKey === envCronSecret) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.replace("Bearer ", "") === serviceKey) return true;
  const internalKey = req.headers.get("x-internal-cron-key");
  if (internalKey === "afrishop-internal-cron-2026") return true;
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

// ─── eBay Search (with offset support) ───────────────────────────────────────

async function searchEbay(token: string, query: string, limit = 20, offset = 0, sort?: string): Promise<{ items: any[]; total: number }> {
  const env = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    offset: String(offset),
    filter: "buyingOptions:{FIXED_PRICE}",
  });
  if (sort) {
    params.set("sort", sort);
  }

  const res = await fetch(`${EBAY_ENDPOINTS[env].browse}/item_summary/search?${params}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "Content-Type": "application/json",
    },
  });

  if (res.status === 429) {
    const raHeader = res.headers.get("Retry-After") || res.headers.get("retry-after") || "0";
    const retryAfterSec = parseInt(raHeader, 10) || 0;
    console.warn(`[WORKER] eBay 429 rate limited, Retry-After=${retryAfterSec}s (raw header: ${raHeader})`);
    const err = new Error("RATE_LIMITED_429");
    (err as any).retryAfterSec = retryAfterSec > 0 ? retryAfterSec : undefined;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[WORKER] eBay error: ${res.status} ${text}`);
    return { items: [], total: 0 };
  }

  const data = await res.json();
  return {
    items: data.itemSummaries || [],
    total: data.total || 0,
  };
}

// ─── eBay Category Browse (using category_ids) ──────────────────────────────

async function searchEbayByCategory(token: string, categoryId: string, limit = 20, offset = 0, sort?: string): Promise<{ items: any[]; total: number }> {
  const env = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";
  const params = new URLSearchParams({
    category_ids: categoryId,
    limit: String(limit),
    offset: String(offset),
    filter: "buyingOptions:{FIXED_PRICE}",
  });
  if (sort) {
    params.set("sort", sort);
  }

  const res = await fetch(`${EBAY_ENDPOINTS[env].browse}/item_summary/search?${params}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "Content-Type": "application/json",
    },
  });

  if (res.status === 429) {
    const raHeader = res.headers.get("Retry-After") || res.headers.get("retry-after") || "0";
    const retryAfterSec = parseInt(raHeader, 10) || 0;
    console.warn(`[WORKER] eBay category 429, Retry-After=${retryAfterSec}s`);
    const err = new Error("RATE_LIMITED_429");
    (err as any).retryAfterSec = retryAfterSec > 0 ? retryAfterSec : undefined;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[WORKER] eBay category error: ${res.status} ${text}`);
    return { items: [], total: 0 };
  }

  const data = await res.json();
  return {
    items: data.itemSummaries || [],
    total: data.total || 0,
  };
}

// ─── Compute data hash ──────────────────────────────────────────────────────

function computeHash(title: string, price: number | null, imageUrl: string | null): string {
  return `${title || ""}|${price || 0}|${imageUrl || ""}`;
}

// ─── Build upsert row from eBay item ─────────────────────────────────────────

function buildUpsertRow(item: any, categoryKey: string, now: string) {
  const priceUsd = item.price?.value ? parseFloat(item.price.value) : null;
  const imageUrl = item.image?.imageUrl?.replace(/^http:/, "https:") || null;
  const hash = computeHash(item.title, priceUsd, imageUrl);

  return {
    provider: "ebay",
    provider_product_id: item.itemId,
    title: item.title,
    price_usd: priceUsd,
    image_url: imageUrl,
    product_url: item.itemWebUrl || `https://www.ebay.com/itm/${item.itemId}`,
    in_stock: item.itemAvailability?.availabilityStatus !== "OUT_OF_STOCK",
    category_key: categoryKey,
    unified_category: categoryKey,
    last_seen_at: now,
    data_updated_at: now,
    price_updated_at: now,
    data_hash: hash,
    is_active: true,
    status_reason: "active",
    fail_count: 0,
    last_checked_at: now,
    updated_at: now,
    tags: [categoryKey],
    buying_options: item.buyingOptions || ["FIXED_PRICE"],
  };
}

// ─── Update provider health in DB ────────────────────────────────────────────

async function updateProviderHealth(supabase: any, provider: string, healthy: boolean, reason?: string, retryAfterSec?: number) {
  const update: any = {
    healthy,
    reason: reason || null,
    updated_at: new Date().toISOString(),
  };
  if (!healthy) {
    const { data: current } = await supabase
      .from("provider_health_status")
      .select("consecutive_failures")
      .eq("provider", provider)
      .maybeSingle();
    const failures = (current?.consecutive_failures || 0) + 1;
    // Guardrail 4: honor Retry-After, else 30 min with jitter
    let backoffMs: number;
    if (retryAfterSec && retryAfterSec > 0) {
      backoffMs = Math.min(retryAfterSec * 1000, 3600000);
    } else {
      const baseMs = 30 * 60 * 1000; // 30 minutes
      const jitterMs = Math.random() * 5 * 60 * 1000; // 0-5 min jitter
      backoffMs = Math.min(3600000, baseMs * Math.pow(2, failures - 1) + jitterMs);
    }
    update.consecutive_failures = failures;
    update.unhealthy_until = new Date(Date.now() + backoffMs).toISOString();
  } else {
    update.consecutive_failures = 0;
    update.unhealthy_until = null;
  }

  await supabase
    .from("provider_health_status")
    .upsert({ provider, ...update }, { onConflict: "provider" });
}

// ─── Process queue jobs ──────────────────────────────────────────────────────

async function processQueueJobs(supabase: any, ebayToken: string, maxJobs: number) {
  const lockId = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  const { data: jobs, error } = await supabase.rpc("claim_refresh_queue_jobs", {
    p_max_jobs: maxJobs,
    p_lock_id: lockId,
  });

  if (error || !jobs?.length) {
    console.log(`[WORKER] No queue jobs found (rpc: ${error?.message || "ok"})`);
    return { processed: 0, upserted: 0 };
  }

  console.log(`[WORKER] Claimed ${jobs.length} jobs atomically (lock=${lockId})`);

  let totalUpserted = 0;

  for (const job of jobs) {
    try {
      const { items } = await searchEbay(ebayToken, job.query, 20);
      
      if (items.length === 0) {
        await supabase.from("catalog_refresh_queue").update({
          status: "done",
          attempts: (job.attempts || 0) + 1,
          last_error: "no_results",
        }).eq("id", job.id);
        continue;
      }

      const upsertRows = items
        .filter((item: any) => item.title && item.itemId)
        .map((item: any) => buildUpsertRow(item, job.category_key, now));

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

      await supabase
        .from("auto_seed_promotions")
        .update({
          last_refreshed_at: now,
          last_refresh_count: upsertRows.length,
          last_refresh_status: upsertRows.length > 0 ? "success" : "empty",
          updated_at: now,
        })
        .eq("query_normalized", job.query)
        .eq("status", "promoted");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.error(`[WORKER] Job ${job.id} failed:`, msg);

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

    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }

  return { processed: jobs.length, upserted: totalUpserted };
}

// ─── Refresh stale items ─────────────────────────────────────────────────────

async function refreshStaleItems(supabase: any, ebayToken: string, maxItems: number) {
  const policy = await getTtlPolicy(supabase);
  const staleDate = new Date(Date.now() - policy.priceRefreshDays * 86_400_000).toISOString();

  const { data: staleItems } = await supabase
    .from("catalog_items")
    .select("id, provider, provider_product_id, category_key, title, price_usd, image_url")
    .eq("is_active", true)
    .eq("provider", "ebay")
    .lte("price_updated_at", staleDate)
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
  const env = (Deno.env.get("EBAY_ENV") || "production") as "production" | "sandbox";

  for (let i = 0; i < staleItems.length; i += MAX_CONCURRENCY) {
    const batch = staleItems.slice(i, i + MAX_CONCURRENCY);

    for (const item of batch) {
      try {
        const itemUrl = `${EBAY_ENDPOINTS[env].browse}/item/${item.provider_product_id}`;
        
        const res = await fetch(itemUrl, {
          headers: {
            "Authorization": `Bearer ${ebayToken}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          },
        });

        if (res.status === 404 || res.status === 410) {
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
  try {
    const { data, error } = await supabase.rpc("cleanup_all_expired_data");
    if (error) console.error("[WORKER] Deactivation cleanup error:", error.message);
    return 0;
  } catch (e: any) {
    console.error("[WORKER] Deactivation skipped:", e.message);
    return 0;
  }
}

// ─── Pool fill planner ───────────────────────────────────────────────────────

async function ensureCategoryPools(supabase: any) {
  const MIN_POOL = 2000;
  const TARGET_POOL = 4000;
  
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

  const thinCategories: string[] = [];
  const allCats = [
    "electronics_phones", "electronics_gaming", "electronics_audio",
    "electronics_computers", "electronics_tablets", "electronics_monitors",
    "electronics_tv", "electronics_wearables", "electronics_accessories",
    "vehicles", "vehicles_cars_trucks", "vehicles_motorcycles",
    "home_garden", "clothing_shoes_accessories",
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

  let enqueued = 0;
  for (const cat of thinCategories) {
    const { data: seeds } = await supabase
      .from("catalog_seed_queries")
      .select("*")
      .eq("category", cat)
      .eq("enabled", true)
      .order("last_refreshed_at", { ascending: true, nullsFirst: true })
      .limit(10);

    for (const seed of seeds || []) {
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
          priority: 10,
          status: "queued",
          scheduled_at: new Date().toISOString(),
        });
        enqueued++;
      }
    }
  }

  return { thinCategories, enqueued };
}

// ─── Seed Backfill Mode ──────────────────────────────────────────────────────

async function runSeedBackfill(supabase: any, ebayToken: string) {
  console.log("[WORKER] === SEED BACKFILL MODE ===");

  const { data: enqueueResult, error: enqErr } = await supabase.rpc("enqueue_all_seeds_ebay", { p_limit: 2000 });
  if (enqErr) {
    console.error("[WORKER] enqueue_all_seeds_ebay failed:", enqErr.message);
    return { error: enqErr.message };
  }
  console.log("[WORKER] Seeds enqueued:", JSON.stringify(enqueueResult));

  let totalProcessed = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    const lockId = `seed-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const { data: jobs, error: claimErr } = await supabase.rpc("claim_refresh_queue_jobs", {
      p_max_jobs: SEED_BACKFILL_BATCH,
      p_lock_id: lockId,
    });

    if (claimErr || !jobs?.length) {
      console.log(`[WORKER] Batch ${batchNum}: queue drained (${claimErr?.message || "no jobs"})`);
      break;
    }

    console.log(`[WORKER] Batch ${batchNum}: claimed ${jobs.length} jobs`);

    for (const job of jobs) {
      try {
        const { items } = await searchEbay(ebayToken, job.query, 20);

        if (items.length === 0) {
          await supabase.from("catalog_refresh_queue").update({
            status: "done",
            attempts: (job.attempts || 0) + 1,
            last_error: "no_results",
          }).eq("id", job.id);

          await supabase.from("auto_seed_promotions").update({
            last_refreshed_at: now,
            last_refresh_count: 0,
            last_refresh_status: "empty",
            updated_at: now,
          }).eq("query_normalized", job.query).eq("status", "promoted");

          totalProcessed++;
          continue;
        }

        const upsertRows = items
          .filter((item: any) => item.title && item.itemId)
          .map((item: any) => buildUpsertRow(item, job.category_key, now));

        if (upsertRows.length > 0) {
          const { error: upsertErr } = await supabase
            .from("catalog_items")
            .upsert(upsertRows, { onConflict: "provider,provider_product_id" });

          if (upsertErr) {
            console.error(`[WORKER] Upsert error job ${job.id}:`, upsertErr.message);
            totalErrors++;
          } else {
            totalUpserted += upsertRows.length;
          }
        }

        await supabase.from("catalog_refresh_queue").update({
          status: "done",
          attempts: (job.attempts || 0) + 1,
        }).eq("id", job.id);

        await supabase.from("auto_seed_promotions").update({
          last_refreshed_at: now,
          last_refresh_count: upsertRows.length,
          last_refresh_status: upsertRows.length > 0 ? "success" : "empty",
          updated_at: now,
        }).eq("query_normalized", job.query).eq("status", "promoted");

        totalProcessed++;

      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        console.error(`[WORKER] Seed job ${job.id} failed:`, msg);
        totalErrors++;

        const is429 = msg.includes("429") || msg.includes("rate limit") || msg.includes("RATE_LIMITED");
        const attempts = (job.attempts || 0) + 1;

        if (is429) {
          const retryAt = new Date(Date.now() + 30 * 60_000).toISOString();
          await supabase.from("catalog_refresh_queue").update({
            status: "queued",
            attempts,
            last_error: "rate_limited_429",
            scheduled_at: retryAt,
            locked_at: null,
            locked_by: null,
          }).eq("id", job.id);
          await new Promise(r => setTimeout(r, 5000));
        } else {
          await supabase.from("catalog_refresh_queue").update({
            status: attempts >= 5 ? "failed" : "queued",
            attempts,
            last_error: msg,
            scheduled_at: new Date(Date.now() + Math.pow(2, attempts) * 10 * 60_000).toISOString(),
            locked_at: null,
            locked_by: null,
          }).eq("id", job.id);
        }
      }

      await new Promise(r => setTimeout(r, SEED_BACKFILL_DELAY_MS));
    }
  }

  const summary = {
    ...enqueueResult,
    processed: totalProcessed,
    upserted: totalUpserted,
    errors: totalErrors,
    batches: batchNum,
  };
  console.log("[WORKER] Seed backfill complete:", JSON.stringify(summary));
  return summary;
}

// ─── Catalog Builder Mode ────────────────────────────────────────────────────

function nextSortMode(current: string): string {
  const idx = BUILDER_SORT_MODES.indexOf(current as any);
  return BUILDER_SORT_MODES[(idx + 1) % BUILDER_SORT_MODES.length];
}

async function runCatalogBuilder(supabase: any, ebayToken: string, providerFilter?: string, customQuery?: string, maxItemsTarget?: number) {
  console.log(`[WORKER] === CATALOG BUILDER MODE (v2 — sort rotation + smart exhaustion)${customQuery ? ` custom_query="${customQuery}"` : ''} ===`);
  const runStart = Date.now();
  const now = new Date().toISOString();
  let requestsThisRun = 0;
  let totalUpserted = 0;
  let totalNewUnique = 0;
  let totalDuplicatesSkipped = 0;
  let rateLimitedCount = 0;
  let sourcesProcessed = 0;
  let rateLimited = false;

  // Check for active campaign
  const { data: campaign } = await supabase
    .from("catalog_builder_goals")
    .select("*")
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (campaign) {
    if (new Date(campaign.end_at) < new Date() && !campaign.continuous) {
      await supabase.from("catalog_builder_goals").update({
        status: "completed",
        updated_at: now,
      }).eq("id", campaign.id);
      console.log("[BUILDER] Campaign window expired, marking completed");
      return { status: "campaign_expired" };
    }
    if (!campaign.continuous && campaign.achieved_total >= campaign.goal_total) {
      await supabase.from("catalog_builder_goals").update({
        status: "completed",
        updated_at: now,
      }).eq("id", campaign.id);
      console.log("[BUILDER] Campaign goal met, marking completed");
      return { status: "campaign_goal_met" };
    }
  }

  // Check builder_paused flag
  const { data: pausedSetting } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", "builder_paused")
    .maybeSingle();

  if (pausedSetting?.value === "true") {
    console.log("[BUILDER] Builder is paused");
    return { status: "paused" };
  }

  // ── CUSTOM QUERY MODE: bypass source rotation, search directly ──
  if (customQuery) {
    const target = maxItemsTarget || 100;
    // Use target-aware page size: don't fetch 100 when we only need 10
    const pageSize = Math.min(BUILDER_ITEMS_PER_PAGE, Math.max(20, target));
    const maxPages = Math.min(40, Math.ceil(target / pageSize) + 2);
    console.log(`[BUILDER] Custom query mode: "${customQuery}" provider=${providerFilter || "ebay"} target=${target} pageSize=${pageSize} maxPages=${maxPages}`);
    let totalUpsertedCQ = 0;
    let totalNewUniqueCQ = 0;
    let totalDupsCQ = 0;
    let requestsCQ = 0;
    let offset = 0;

    for (let page = 0; page < maxPages; page++) {
      const timeRemaining = BUILDER_TIME_BUDGET_MS - (Date.now() - runStart);
      if (timeRemaining < BUILDER_RESERVE_MS) break;
      if (requestsCQ >= BUILDER_MAX_REQUESTS_PER_RUN) break;
      // Stop once we've reached the target of NEW UNIQUE items
      if (totalNewUniqueCQ >= target) {
        console.log(`[BUILDER] Custom query target reached: ${totalNewUniqueCQ} new unique >= ${target}`);
        break;
      }

      try {
        const { items, total } = await searchEbay(ebayToken, customQuery, pageSize, offset);
        requestsCQ++;

        if (items.length === 0 || offset >= total) break;

        const categoryKey = "general"; // Will be auto-classified by ingestion guardrails
        const upsertRows = items
          .filter((item: any) => item.title && item.itemId)
          .map((item: any) => buildUpsertRow(item, categoryKey, now));

        if (upsertRows.length > 0) {
          // Check which items already exist in DB
          const productIds = upsertRows.map((r: any) => r.provider_product_id);
          const { data: existingRows } = await supabase
            .from("catalog_items")
            .select("provider_product_id")
            .eq("provider", "ebay")
            .in("provider_product_id", productIds);

          const existingSet = new Set((existingRows || []).map((r: any) => r.provider_product_id));
          
          // Filter to only truly new items — skip duplicates entirely
          const newRows = upsertRows.filter((r: any) => !existingSet.has(r.provider_product_id));
          const dupCount = upsertRows.length - newRows.length;
          totalDupsCQ += dupCount;

          if (newRows.length > 0) {
            // Trim to not exceed target
            const remaining = target - totalNewUniqueCQ;
            const toInsert = newRows.slice(0, remaining);

            const { error: upsertErr } = await supabase
              .from("catalog_items")
              .upsert(toInsert, { onConflict: "provider,provider_product_id" });

            if (!upsertErr) {
              totalUpsertedCQ += toInsert.length;
              totalNewUniqueCQ += toInsert.length;
              console.log(`[BUILDER] Page ${page}: inserted ${toInsert.length} new, skipped ${dupCount} dups (total new: ${totalNewUniqueCQ}/${target})`);
            } else {
              console.error(`[BUILDER] Custom query upsert error:`, upsertErr.message);
            }
          } else {
            console.log(`[BUILDER] Page ${page}: all ${upsertRows.length} items are duplicates, skipping`);
          }
        }

        offset += items.length;
        const jitter = Math.floor(Math.random() * 400);
        await new Promise(r => setTimeout(r, BUILDER_DELAY_MS + jitter));

      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        if (msg.includes("RATE_LIMITED_429")) {
          const retryAfterSec = (err as any).retryAfterSec;
          await updateProviderHealth(supabase, providerFilter || "ebay", false, "429_rate_limited", retryAfterSec);
          break;
        }
        console.error(`[BUILDER] Custom query error:`, msg);
        break;
      }
    }

    // Log run
    const cqResult = {
      items_upserted: totalUpsertedCQ,
      new_unique_items: totalNewUniqueCQ,
      duplicates_skipped: totalDupsCQ,
      rate_limited_count: 0,
      sources_processed: 1,
      duration_ms: Date.now() - runStart,
      custom_query: customQuery,
    };
    await supabase.from("catalog_builder_runs").insert({
      goal_id: campaign?.id || null,
      provider: providerFilter || "ebay",
      started_at: new Date(runStart).toISOString(),
      finished_at: new Date().toISOString(),
      items_upserted: cqResult.items_upserted,
      new_unique_items: cqResult.new_unique_items,
      duplicates_skipped: cqResult.duplicates_skipped,
      rate_limited_count: cqResult.rate_limited_count,
      sources_processed: cqResult.sources_processed,
      duration_ms: cqResult.duration_ms,
    });
    console.log("[BUILDER] Custom query complete:", JSON.stringify(cqResult));
    return cqResult;
  }

  // Get builder sources (enabled), round-robin by category
  let sourcesQuery = supabase
    .from("catalog_builder_sources")
    .select("*, catalog_builder_state(*)")
    .eq("enabled", true)
    .order("priority", { ascending: true });

  if (providerFilter) {
    sourcesQuery = sourcesQuery.eq("provider", providerFilter);
  }

  const { data: sources, error: srcErr } = await sourcesQuery.limit(100);

  if (srcErr || !sources?.length) {
    console.log("[BUILDER] No sources found:", srcErr?.message || "empty");
    return { status: "no_sources", error: srcErr?.message };
  }

  // Filter out exhausted sources (respect cooldown)
  const activeSources: any[] = [];
  for (const s of sources) {
    const state = s.catalog_builder_state?.[0];
    if (!state?.exhausted) {
      activeSources.push(s);
      continue;
    }
    if (state.cooldown_until && new Date(state.cooldown_until) <= new Date()) {
      // Cooldown expired — reset and rotate sort mode
      const newSort = nextSortMode(state.sort_mode || "newlyListed");
      await supabase.from("catalog_builder_state").update({
        exhausted: false,
        cooldown_until: null,
        last_error: null,
        current_offset: 0,
        sort_mode: newSort,
        consecutive_zero_new_pages: 0,
      }).eq("source_id", s.id);
      console.log(`[BUILDER] Source ${s.id} cooldown expired, reset with sort=${newSort}`);
      activeSources.push(s);
      continue;
    }
  }

  if (activeSources.length === 0) {
    console.log("[BUILDER] All sources exhausted");
    return { status: "all_exhausted" };
  }

  // Prioritize category sources over seed queries, shuffle within groups
  const categorySources = activeSources.filter((s: any) => s.source_type === "ebay_category");
  const seedSources = activeSources.filter((s: any) => s.source_type !== "ebay_category");
  const shuffleArr = (arr: any[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const shuffled = [...shuffleArr([...categorySources]), ...shuffleArr([...seedSources])];

  for (const source of shuffled) {
    const timeRemaining = BUILDER_TIME_BUDGET_MS - (Date.now() - runStart);
    if (timeRemaining < BUILDER_RESERVE_MS) {
      console.log(`[BUILDER] Time budget: ${timeRemaining}ms remaining < ${BUILDER_RESERVE_MS}ms reserve, stopping cleanly`);
      break;
    }
    if (requestsThisRun >= BUILDER_MAX_REQUESTS_PER_RUN) {
      console.log("[BUILDER] Request budget reached, stopping");
      break;
    }
    if (rateLimited) break;

    const state = source.catalog_builder_state?.[0];
    let currentOffset = state?.current_offset || 0;
    let sourceIngested = 0;
    let emptyPages = 0;
    let consecutiveZeroNew = state?.consecutive_zero_new_pages || 0;
    const sortMode = state?.sort_mode || "newlyListed";

    // Ensure state row exists
    if (!state) {
      await supabase.from("catalog_builder_state").upsert({
        source_id: source.id,
        current_offset: 0,
        total_ingested: 0,
        exhausted: false,
        sort_mode: "newlyListed",
        consecutive_zero_new_pages: 0,
      }, { onConflict: "source_id" });
    }

    console.log(`[BUILDER] Source ${source.id} cat=${source.category_key} sort=${sortMode} offset=${currentOffset}`);

    // Fetch up to BUILDER_PAGES_PER_SOURCE pages
    for (let page = 0; page < BUILDER_PAGES_PER_SOURCE; page++) {
      if (requestsThisRun >= BUILDER_MAX_REQUESTS_PER_RUN) break;
      if ((BUILDER_TIME_BUDGET_MS - (Date.now() - runStart)) < BUILDER_RESERVE_MS) break;
      if (rateLimited) break;

      try {
        let items: any[];
        let total: number;

        if (source.source_type === "ebay_category") {
          const result = await searchEbayByCategory(ebayToken, source.source_value, BUILDER_ITEMS_PER_PAGE, currentOffset, sortMode);
          items = result.items;
          total = result.total;
        } else {
          const result = await searchEbay(ebayToken, source.source_value, BUILDER_ITEMS_PER_PAGE, currentOffset, sortMode);
          items = result.items;
          total = result.total;
        }
        requestsThisRun++;

        if (items.length === 0) {
          emptyPages++;
          if (emptyPages >= 2) {
            const cooldownUntil = new Date(Date.now() + BUILDER_EXHAUSTION_COOLDOWN_DAYS * 86400000).toISOString();
            await supabase.from("catalog_builder_state").upsert({
              source_id: source.id,
              exhausted: true,
              cooldown_until: cooldownUntil,
              last_run_at: now,
              last_error: "empty_pages",
              consecutive_zero_new_pages: consecutiveZeroNew,
            }, { onConflict: "source_id" });
            break;
          }
          continue;
        }

        // Check if offset >= total (truly exhausted the listing space)
        if (currentOffset >= total) {
          const cooldownUntil = new Date(Date.now() + BUILDER_EXHAUSTION_COOLDOWN_DAYS * 86400000).toISOString();
          await supabase.from("catalog_builder_state").upsert({
            source_id: source.id,
            exhausted: true,
            cooldown_until: cooldownUntil,
            last_run_at: now,
            last_error: "offset_exceeded_total",
            consecutive_zero_new_pages: consecutiveZeroNew,
          }, { onConflict: "source_id" });
          break;
        }

        // Build upsert rows
        const upsertRows = items
          .filter((item: any) => item.title && item.itemId)
          .map((item: any) => buildUpsertRow(item, source.category_key, now));

        if (upsertRows.length === 0) continue;

        const productIds = upsertRows.map((r: any) => r.provider_product_id);

        // PREFETCH: check which IDs already exist BEFORE upserting
        const { data: existingRows } = await supabase
          .from("catalog_items")
          .select("provider_product_id")
          .eq("provider", "ebay")
          .in("provider_product_id", productIds);

        const existingSet = new Set((existingRows || []).map((r: any) => r.provider_product_id));
        const newItems = productIds.filter((id: string) => !existingSet.has(id)).length;
        const duplicateCount = productIds.length - newItems;
        const duplicateRatio = productIds.length > 0 ? duplicateCount / productIds.length : 0;

        // NOW upsert
        const { error: upsertErr } = await supabase
          .from("catalog_items")
          .upsert(upsertRows, { onConflict: "provider,provider_product_id" });

        if (upsertErr) {
          console.error(`[BUILDER] Upsert error source ${source.id}:`, upsertErr.message);
        } else {
          totalUpserted += upsertRows.length;
          totalNewUnique += newItems;
          totalDuplicatesSkipped += duplicateCount;
          sourceIngested += newItems;
        }

        // ── SMART EXHAUSTION LOGIC (v2) ──
        if (newItems === 0) {
          consecutiveZeroNew++;
        } else {
          consecutiveZeroNew = 0; // Reset on any discovery
        }

        // Strategy based on duplicate ratio:
        if (consecutiveZeroNew >= BUILDER_CONSECUTIVE_ZERO_THRESHOLD) {
          // 5+ consecutive pages with zero new → truly exhausted for this sort
          const newSort = nextSortMode(sortMode);
          const cooldownUntil = new Date(Date.now() + BUILDER_EXHAUSTION_COOLDOWN_DAYS * 86400000).toISOString();
          console.log(`[BUILDER] Source ${source.id} exhausted after ${consecutiveZeroNew} zero-new pages, will rotate to sort=${newSort} on reset`);
          await supabase.from("catalog_builder_state").upsert({
            source_id: source.id,
            exhausted: true,
            cooldown_until: cooldownUntil,
            last_run_at: now,
            last_error: `exhausted_${consecutiveZeroNew}_zero_pages_sort_${sortMode}`,
            sort_mode: newSort, // Pre-set next sort for when cooldown expires
            consecutive_zero_new_pages: consecutiveZeroNew,
          }, { onConflict: "source_id" });
          break;
        } else if (duplicateRatio > 0.9 && newItems === 0) {
          // >90% duplicates and zero new: JUMP forward instead of exhausting
          const jumpAmount = BUILDER_OFFSET_JUMP;
          currentOffset = Math.min(currentOffset + jumpAmount, Math.max(0, total - BUILDER_ITEMS_PER_PAGE));
          console.log(`[BUILDER] Source ${source.id} high duplicates (${(duplicateRatio * 100).toFixed(0)}%), jumping offset +${jumpAmount} to ${currentOffset}`);
        } else {
          // Normal: advance offset by items received
          currentOffset += items.length;
        }

        // Persist state after each page
        await supabase.from("catalog_builder_state").upsert({
          source_id: source.id,
          current_offset: currentOffset,
          total_ingested: (state?.total_ingested || 0) + sourceIngested,
          last_run_at: now,
          last_error: null,
          consecutive_zero_new_pages: consecutiveZeroNew,
        }, { onConflict: "source_id" });

        // For newlyListed sort, cap at 500 then move on (don't reset to 0 mid-run — causes loops)
        if (sortMode === "newlyListed" && currentOffset > 500) {
          console.log(`[BUILDER] Source ${source.id} newlyListed: offset ${currentOffset} > 500, moving to next source`);
          break;
        }

        // Delay with jitter
        const jitter = Math.floor(Math.random() * 400);
        await new Promise(r => setTimeout(r, BUILDER_DELAY_MS + jitter));

      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";

        if (msg.includes("RATE_LIMITED_429")) {
          rateLimited = true;
          rateLimitedCount++;
          const retryAfterSec = (err as any).retryAfterSec;
          await updateProviderHealth(supabase, source.provider, false, "429_rate_limited", retryAfterSec);
          await supabase.from("catalog_builder_state").upsert({
            source_id: source.id,
            current_offset: currentOffset,
            last_run_at: now,
            last_error: "rate_limited",
            consecutive_zero_new_pages: consecutiveZeroNew,
          }, { onConflict: "source_id" });
          break;
        }

        console.error(`[BUILDER] Error source ${source.id}:`, msg);
        await supabase.from("catalog_builder_state").upsert({
          source_id: source.id,
          current_offset: currentOffset,
          last_run_at: now,
          last_error: msg,
          consecutive_zero_new_pages: consecutiveZeroNew,
        }, { onConflict: "source_id" });
        break;
      }
    }

    sourcesProcessed++;
  }

  // If no rate limit, mark provider healthy
  if (!rateLimited) {
    await updateProviderHealth(supabase, providerFilter || "ebay", true);
  }

  // Update campaign counters
  if (campaign && totalNewUnique > 0) {
    const providerField = providerFilter === "rainforest" ? "achieved_rainforest" : "achieved_ebay";
    await supabase.from("catalog_builder_goals").update({
      achieved_total: campaign.achieved_total + totalNewUnique,
      [providerField]: (campaign[providerField] || 0) + totalNewUnique,
      last_run_at: now,
      updated_at: now,
    }).eq("id", campaign.id);
  }

  // Log run
  const runResult = {
    items_upserted: totalUpserted,
    new_unique_items: totalNewUnique,
    duplicates_skipped: totalDuplicatesSkipped,
    rate_limited_count: rateLimitedCount,
    sources_processed: sourcesProcessed,
    duration_ms: Date.now() - runStart,
  };

  await supabase.from("catalog_builder_runs").insert({
    goal_id: campaign?.id || null,
    provider: providerFilter || "ebay",
    started_at: new Date(runStart).toISOString(),
    finished_at: new Date().toISOString(),
    ...runResult,
  });

  console.log("[BUILDER] Complete:", JSON.stringify(runResult));
  return runResult;
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
  let mode = "queue";
  let provider: string | undefined;
  let customQuery: string | undefined;
  let maxItemsTarget: number | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    maxJobs = body.maxJobs || 10;
    mode = body.mode || "queue";
    provider = body.provider;
    customQuery = body.custom_query;
    maxItemsTarget = body.max_items_target;
  } catch { /* defaults */ }

  const url = new URL(req.url);
  mode = url.searchParams.get("mode") || mode;
  provider = url.searchParams.get("provider") || provider;

  const supabase = createClient(supabaseUrl, serviceKey);
  const startTime = Date.now();
  const results: Record<string, any> = { mode };

  try {
    const ebayToken = await getEbayToken(supabase);

    if (mode === "catalog-builder") {
      results.builder = await runCatalogBuilder(supabase, ebayToken, provider, customQuery, maxItemsTarget);
    } else if (mode === "seed-backfill") {
      results.seedBackfill = await runSeedBackfill(supabase, ebayToken);
    } else {
      if (mode === "queue" || mode === "all") {
        results.queue = await processQueueJobs(supabase, ebayToken, maxJobs);
      }

      if (mode === "stale" || mode === "all") {
        results.stale = await refreshStaleItems(supabase, ebayToken, maxJobs);
      }

      if (mode === "pool-fill" || mode === "all") {
        results.poolFill = await ensureCategoryPools(supabase);
      }

      results.deactivated = await deactivateOldItems(supabase);
    }

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
