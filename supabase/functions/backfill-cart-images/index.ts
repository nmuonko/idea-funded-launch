import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  handleCors, 
  jsonResponse,
  createAdminClient,
} from "../_shared/auth.ts";

/**
 * Backfill missing cart images from product_cache or by fetching OG images.
 * This is a one-time admin utility that runs for items with null product_image_url.
 * 
 * POST /functions/v1/backfill-cart-images
 * Body: { "limit": 50 } (optional, default 50)
 * 
 * Requires admin auth or cron secret.
 */

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Extract OG image from HTML
 */
function extractOgImage(html: string): string | null {
  const patterns = [
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i,
    /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+name=["']twitter:image["']/i,
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Lightweight fetch of just the OG image from a URL (3s timeout)
 */
async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`[backfill-cart-images] Fetch failed for ${url}: ${response.status}`);
      return null;
    }
    
    // Only read first 100KB for OG extraction
    const reader = response.body?.getReader();
    if (!reader) return null;
    
    let html = '';
    const decoder = new TextDecoder();
    const maxBytes = 100 * 1024;
    let bytesRead = 0;
    
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytesRead += value.length;
      
      // Early exit if we found og:image
      const ogImage = extractOgImage(html);
      if (ogImage) {
        reader.cancel();
        return ogImage;
      }
    }
    
    reader.cancel();
    return extractOgImage(html);
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log(`[backfill-cart-images] Timeout for ${url}`);
    } else {
      console.log(`[backfill-cart-images] Error for ${url}: ${err.message}`);
    }
    return null;
  }
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Check for cron secret or admin auth
    const cronSecret = Deno.env.get('CRON_SECRET');
    const authHeader = req.headers.get('Authorization');
    
    if (authHeader !== `Bearer ${cronSecret}`) {
      // Verify admin if not cron
      const supabase = createAdminClient();
      const token = authHeader?.replace('Bearer ', '');
      
      if (token) {
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          const { data: isAdmin } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id)
            .eq('role', 'admin')
            .maybeSingle();
          
          if (!isAdmin) {
            return jsonResponse({ ok: false, error: 'Admin access required' }, 403);
          }
        } else {
          return jsonResponse({ ok: false, error: 'Authentication required' }, 401);
        }
      } else {
        return jsonResponse({ ok: false, error: 'Authentication required' }, 401);
      }
    }

    const supabase = createAdminClient();
    
    // Parse limit from body
    let limit = 50;
    try {
      const body = await req.json();
      if (body.limit && typeof body.limit === 'number') {
        limit = Math.min(body.limit, 200);
      }
    } catch {
      // Use default limit
    }

    console.log(`[backfill-cart-images] Starting backfill with limit=${limit}`);

    // Find DRAFT order items with missing images
    const { data: items, error: fetchError } = await supabase
      .from('order_items')
      .select(`
        id, 
        product_url, 
        product_image_url,
        orders!inner(status)
      `)
      .is('product_image_url', null)
      .eq('orders.status', 'DRAFT')
      .limit(limit);

    if (fetchError) {
      console.error('[backfill-cart-images] Fetch error:', fetchError);
      return jsonResponse({ ok: false, error: fetchError.message }, 500);
    }

    if (!items || items.length === 0) {
      console.log('[backfill-cart-images] No items to backfill');
      return jsonResponse({ 
        ok: true, 
        backfilled: 0, 
        message: 'No items need backfilling' 
      });
    }

    console.log(`[backfill-cart-images] Found ${items.length} items to backfill`);

    let backfilledCount = 0;
    let cacheHits = 0;
    let fetchedCount = 0;
    const results: { id: string; source: string; success: boolean }[] = [];

    for (const item of items) {
      let imageUrl: string | null = null;
      let source = 'none';

      // 1. Try product_cache first
      const { data: cached } = await supabase
        .from('product_cache')
        .select('image_url')
        .eq('product_url', item.product_url)
        .maybeSingle();

      if (cached?.image_url) {
        imageUrl = cached.image_url;
        source = 'cache';
        cacheHits++;
      } else {
        // 2. Try fetching OG image (best effort, non-blocking)
        imageUrl = await fetchOgImage(item.product_url);
        if (imageUrl) {
          source = 'og_fetch';
          fetchedCount++;
          
          // Also save to product_cache for future
          await supabase
            .from('product_cache')
            .upsert({
              product_url: item.product_url,
              image_url: imageUrl,
              source: 'og_backfill',
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            }, { onConflict: 'product_url' });
        }
      }

      if (imageUrl) {
        // Update the cart item
        const { error: updateError } = await supabase
          .from('order_items')
          .update({ product_image_url: imageUrl })
          .eq('id', item.id);

        if (!updateError) {
          backfilledCount++;
          results.push({ id: item.id, source, success: true });
          console.log(`[backfill-cart-images] Updated ${item.id} from ${source}`);
        } else {
          results.push({ id: item.id, source, success: false });
          console.error(`[backfill-cart-images] Failed to update ${item.id}:`, updateError);
        }
      } else {
        results.push({ id: item.id, source: 'none', success: false });
        console.log(`[backfill-cart-images] No image found for ${item.id}`);
      }
    }

    console.log(`[backfill-cart-images] Complete: ${backfilledCount}/${items.length} backfilled`);

    return jsonResponse({
      ok: true,
      total: items.length,
      backfilled: backfilledCount,
      cacheHits,
      fetched: fetchedCount,
      results,
    });

  } catch (error: any) {
    console.error('[backfill-cart-images] Error:', error.message);
    return jsonResponse({ ok: false, error: error.message }, 500);
  }
});