/**
 * Search Auto-Cache — upserts live provider results into catalog_items
 * so future DB-first searches return them instantly.
 * 
 * Runs fire-and-forget after provider fetch completes.
 * Never blocks the response.
 */

type SupabaseClientAny = any;

export interface AutoCacheItem {
  id?: string;
  provider: string;
  providerProductId?: string;
  provider_product_id?: string;
  title: string;
  imageUrl?: string;
  image_url?: string;
  productUrl?: string;
  product_url?: string;
  priceUsd?: number;
  price_usd?: number;
  currency?: string;
  category?: string;
  rating?: number;
  inStock?: boolean;
  in_stock?: boolean;
}

export interface AutoCacheResult {
  upserted: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

/**
 * Upsert live provider items into catalog_items for future DB-first hits.
 * 
 * - Uses ON CONFLICT on (id) to update price/availability if item exists
 * - Sets is_active=true, last_seen_at=now(), price_updated_at=now()
 * - Skips items without required fields (title, image, price)
 * - Runs in batches of 50 to avoid overloading DB
 */
export async function autoCacheLiveResults(
  supabase: SupabaseClientAny,
  items: AutoCacheItem[],
  categoryKey: string | null,
  requestId: string,
): Promise<AutoCacheResult> {
  const startMs = Date.now();
  let upserted = 0;
  let skipped = 0;
  let errors = 0;

  // Filter items with required fields
  const validItems = items.filter(item => {
    const title = item.title;
    const imageUrl = item.imageUrl || item.image_url;
    const price = item.priceUsd || item.price_usd;
    const provider = item.provider;
    if (!title || !imageUrl || !price || price <= 0 || !provider) {
      skipped++;
      return false;
    }
    return true;
  });

  if (validItems.length === 0) {
    return { upserted: 0, skipped, errors: 0, durationMs: Date.now() - startMs };
  }

  // Build upsert records
  const now = new Date().toISOString();
  const records = validItems.map(item => {
    const providerProductId = item.providerProductId || item.provider_product_id || item.id || "";
    return {
      // Do NOT set `id` — let DB keep existing PK or auto-generate.
      // Upsert matches on (provider, provider_product_id) unique constraint.
      provider: item.provider,
      provider_product_id: providerProductId,
      title: item.title,
      image_url: item.imageUrl || item.image_url,
      product_url: item.productUrl || item.product_url || "",
      price_usd: item.priceUsd || item.price_usd,
      currency: item.currency || "USD",
      unified_category: categoryKey || item.category || null,
      category_key: categoryKey || item.category || null,
      rating: item.rating || null,
      in_stock: item.inStock ?? item.in_stock ?? true,
      is_active: true,
      is_disallowed: false,
      status_reason: "active",
      fail_count: 0,
      last_seen_at: now,
      price_updated_at: now,
      updated_at: now,
    };
  });

  // Batch upsert (50 at a time)
  const BATCH_SIZE = 50;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await supabase
        .from("catalog_items")
        .upsert(batch, {
          onConflict: "provider,provider_product_id",
          ignoreDuplicates: false,
        });

      if (error) {
        console.warn(`[AUTO_CACHE] requestId=${requestId} batch ${i / BATCH_SIZE} error: ${error.message}`);
        errors += batch.length;
      } else {
        upserted += batch.length;
      }
    } catch (err) {
      console.warn(`[AUTO_CACHE] requestId=${requestId} batch ${i / BATCH_SIZE} exception: ${(err as Error).message}`);
      errors += batch.length;
    }
  }

  const durationMs = Date.now() - startMs;
  if (upserted > 0) {
    console.log(`[AUTO_CACHE] requestId=${requestId} upserted=${upserted} skipped=${skipped} errors=${errors} category=${categoryKey} ms=${durationMs}`);
  }

  return { upserted, skipped, errors, durationMs };
}

/**
 * Log a search query for analytics and auto-seed promotion.
 * Fire-and-forget — never throws.
 */
export async function logSearchQuery(
  supabase: SupabaseClientAny,
  params: {
    qNorm: string;
    qOriginal: string;
    categoryGuess: string | null;
    dbCount: number;
    liveCount: number;
    usedLive: boolean;
    fuzzyUsed: boolean;
    expansionUsed: boolean;
    autoCachedCount: number;
    durationMs: number;
  },
): Promise<void> {
  try {
    await supabase.from("search_query_log").insert({
      q_norm: params.qNorm,
      q_original: params.qOriginal,
      category_guess: params.categoryGuess,
      db_count: params.dbCount,
      live_count: params.liveCount,
      used_live: params.usedLive,
      fuzzy_used: params.fuzzyUsed,
      expansion_used: params.expansionUsed,
      auto_cached_count: params.autoCachedCount,
      duration_ms: params.durationMs,
    });
  } catch {
    // Never throw — logging is best-effort
  }
}

/**
 * Enqueue a refresh job for a search query so future requests are cached.
 * Fire-and-forget.
 */
export async function enqueueRefreshJob(
  supabase: SupabaseClientAny,
  qNorm: string,
  categoryKey: string | null,
  provider: string,
  requestId: string,
): Promise<void> {
  try {
    await supabase.from("catalog_refresh_queue").insert({
      category_key: categoryKey || "general",
      provider,
      query: qNorm,
      priority: 5,
      status: "queued",
      scheduled_at: new Date().toISOString(),
    });
    console.log(`[AUTO_CACHE] requestId=${requestId} enqueued refresh job: q="${qNorm}" cat=${categoryKey} provider=${provider}`);
  } catch {
    // Best-effort
  }
}
