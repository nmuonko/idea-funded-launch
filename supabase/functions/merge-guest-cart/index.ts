import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface GuestCartItem {
  productUrl: string;
  title?: string;
  imageUrl?: string;
  store?: string;
  unitPrice: number;
  quantity: number;
  currency?: string;
}

interface MergeRequest {
  guest_device_id?: string;  // Device ID for tracking
  guest_items: GuestCartItem[];  // Items stored locally on device
  idempotency_key?: string;  // Idempotency key to prevent duplicate merges
}

// Normalize URLs to prevent duplicates
function normalizeProductUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove query params and trailing slashes for comparison
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

// Detect store from URL
function detectStore(url: string): string {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('amazon.')) return 'AMAZON';
  if (lowerUrl.includes('ebay.')) return 'EBAY';
  if (lowerUrl.includes('walmart.')) return 'WALMART';
  if (lowerUrl.includes('tesla.')) return 'TESLA_USED';
  if (lowerUrl.includes('carvana.')) return 'CARVANA';
  if (lowerUrl.includes('cargurus.')) return 'CARGURUS';
  if (lowerUrl.includes('wayfair.')) return 'WAYFAIR';
  if (lowerUrl.includes('mercari.')) return 'MERCARI';
  if (lowerUrl.includes('temu.')) return 'TEMU';
  if (lowerUrl.includes('bestbuy.')) return 'BESTBUY';
  return 'OTHER';
}

// Check if item is a vehicle
function isVehicleItem(url: string, store: string): boolean {
  const vehicleStores = ['CARVANA', 'CARGURUS', 'TESLA_USED', 'EDMUNDS'];
  if (vehicleStores.includes(store)) return true;
  
  const vehiclePatterns = [
    /inventory\/used/i,
    /inventory\/new/i,
    /vehicles?\//i,
    /\/cars?\//i,
    /\/trucks?\//i,
  ];
  
  return vehiclePatterns.some(pattern => pattern.test(url));
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] merge-guest-cart: Start`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[${requestId}] Missing environment variables`);
      return new Response(
        JSON.stringify({ success: false, code: 'CONFIG_ERROR', message: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract bearer token for user auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.log(`[${requestId}] Missing auth header`);
      return new Response(
        JSON.stringify({ success: false, code: 'AUTH_REQUIRED', message: 'Authentication required to merge cart' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verify user token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.log(`[${requestId}] Invalid token:`, authError?.message);
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_TOKEN', message: 'Invalid or expired session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${requestId}] User authenticated:`, user.id);

    // Parse request body
    let body: MergeRequest;
    try {
      body = await req.json();
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_JSON', message: 'Invalid request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const guestItems = body.guest_items || [];
    const guestDeviceId = body.guest_device_id;
    const idempotencyKey = body.idempotency_key;

    // Check idempotency - prevent duplicate merge requests
    if (idempotencyKey) {
      const idempotencyKeyFull = `merge_cart:${user.id}:${idempotencyKey}`;
      
      const { data: rateCheck } = await supabase
        .rpc('check_rate_limit', {
          p_key: idempotencyKeyFull,
          p_limit: 1,
          p_window_minutes: 60, // 1 hour window for idempotency
        });

      if (rateCheck && !rateCheck.allowed) {
        console.log(`[${requestId}] Idempotent request - already processed:`, idempotencyKey);
        
        // Return success but indicate it was already processed
        // Fetch current cart state to return
        const { data: existingOrder } = await supabase
          .from('orders')
          .select('id, total_usd, total_cdf, item_total_usd, shipping_fee_usd, requires_manual_quote')
          .eq('user_id', user.id)
          .eq('status', 'DRAFT')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        
        return new Response(
          JSON.stringify({
            success: true,
            idempotent: true,
            merged_count: 0,
            skipped_count: guestItems.length,
            cart_id: existingOrder?.id || null,
            totals: existingOrder ? {
              item_total_usd: existingOrder.item_total_usd,
              shipping_fee_usd: existingOrder.shipping_fee_usd,
              total_usd: existingOrder.total_usd,
              total_cdf: existingOrder.total_cdf,
              requires_manual_quote: existingOrder.requires_manual_quote,
            } : null,
            message: 'Request already processed (idempotent)',
            requestId,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log(`[${requestId}] Idempotency key accepted:`, idempotencyKey);
    }

    if (!guestItems.length) {
      console.log(`[${requestId}] No guest items to merge`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          merged_count: 0, 
          message: 'No items to merge',
          requestId,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${requestId}] Merging ${guestItems.length} guest items for user:`, user.id);
    if (guestDeviceId) {
      console.log(`[${requestId}] Guest device ID:`, guestDeviceId);
    }
    if (idempotencyKey) {
      console.log(`[${requestId}] Idempotency key:`, idempotencyKey);
    }

    // Fetch settings from cache (avoids redundant DB reads)
    const { getCachedGlobalSettings } = await import("../_shared/settingsMemoryCache.ts");
    const settings = await getCachedGlobalSettings(supabase) as Record<string, any>;

    const markupPercent = Number(settings?.markup_percent) || 15;
    const exchangeRate = Number(settings?.exchange_rate_usd_to_cdf) || 2500;
    const shippingBaseFee = Number(settings?.shipping_base_fee_usd) || 10;
    
    // SAFEGUARD: Normalize shipping_percent to decimal (0.10) regardless of storage format
    // If > 1, it's stored as percent (10) so divide by 100; otherwise treat as decimal (0.10)
    const rawShippingPercent = Number(settings?.shipping_percent) || 0.10;
    const shippingPercent = rawShippingPercent > 1 ? rawShippingPercent / 100 : rawShippingPercent;
    const shippingCalcMode = rawShippingPercent > 1 ? 'percent_to_decimal' : 'already_decimal';
    
    console.log(`[${requestId}] Shipping percent normalization:`, {
      raw: rawShippingPercent,
      normalized: shippingPercent,
      mode: shippingCalcMode,
    });

    // Find or create user's DRAFT order
    let { data: draftOrder } = await supabase
      .from('orders')
      .select('id, cart_version')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!draftOrder) {
      // Create new DRAFT order
      const { data: newOrder, error: createError } = await supabase
        .from('orders')
        .insert({
          user_id: user.id,
          status: 'DRAFT',
          cart_version: 1,
          exchange_rate_used: exchangeRate,
        })
        .select('id, cart_version')
        .single();

      if (createError) {
        console.error(`[${requestId}] Failed to create order:`, createError.message);
        return new Response(
          JSON.stringify({ success: false, code: 'CREATE_ORDER_FAILED', message: 'Failed to create cart' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      draftOrder = newOrder;
      console.log(`[${requestId}] Created new DRAFT order:`, draftOrder.id);
    }

    // Get existing items to avoid duplicates
    const { data: existingItems } = await supabase
      .from('order_items')
      .select('id, product_url, vehicle_quote_applied')
      .eq('order_id', draftOrder.id);

    const existingByUrl = new Map<string, { id: string; hasQuote: boolean }>();
    (existingItems || []).forEach((item: any) => {
      const normalizedUrl = normalizeProductUrl(item.product_url);
      existingByUrl.set(normalizedUrl, {
        id: item.id,
        hasQuote: item.vehicle_quote_applied === true,
      });
    });

    // DEDUPLICATE guest items by normalized URL BEFORE processing
    // This prevents duplicates and ensures we don't process the same item twice
    const seenNormalizedUrls = new Set<string>();
    const dedupedGuestItems: GuestCartItem[] = [];
    
    for (const item of guestItems) {
      if (!item.productUrl) continue;
      const normalized = normalizeProductUrl(item.productUrl);
      if (!seenNormalizedUrls.has(normalized)) {
        seenNormalizedUrls.add(normalized);
        dedupedGuestItems.push(item);
      } else {
        console.log(`[${requestId}] Deduped guest item (same normalized URL):`, normalized);
      }
    }
    
    console.log(`[${requestId}] Deduped ${guestItems.length} -> ${dedupedGuestItems.length} items`);

    // Merge items (idempotent - safe to retry)
    let mergedCount = 0;
    let skippedCount = 0;

    for (const guestItem of dedupedGuestItems) {
      if (!guestItem.productUrl || guestItem.unitPrice <= 0) {
        console.log(`[${requestId}] Skipping invalid item:`, guestItem);
        skippedCount++;
        continue;
      }

      const normalizedUrl = normalizeProductUrl(guestItem.productUrl);
      const existingItem = existingByUrl.get(normalizedUrl);

      // Don't overwrite items with vehicle quotes applied
      if (existingItem?.hasQuote) {
        console.log(`[${requestId}] Skipping - vehicle quote exists:`, normalizedUrl);
        skippedCount++;
        continue;
      }

      const store = guestItem.store?.toUpperCase() || detectStore(guestItem.productUrl);
      const isVehicle = isVehicleItem(guestItem.productUrl, store);
      
      const quantity = Math.max(1, Math.min(100, guestItem.quantity || 1));
      const basePrice = Math.round(guestItem.unitPrice * 100) / 100;
      const baseTotalUsd = Math.round(basePrice * quantity * 100) / 100;
      const marginUsd = Math.round(baseTotalUsd * (markupPercent / 100) * 100) / 100;
      const subtotalUsd = Math.round((baseTotalUsd + marginUsd) * 100) / 100;
      const subtotalCdf = Math.round(subtotalUsd * exchangeRate);

      const itemData = {
        order_id: draftOrder.id,
        product_url: guestItem.productUrl,
        title: guestItem.title || null,
        product_image_url: guestItem.imageUrl || null,
        store: store,
        base_price_usd: basePrice,
        unit_price_usd: basePrice,
        quantity: quantity,
        subtotal_usd: baseTotalUsd,
        markup_fee_usd: marginUsd,
        total_price_usd: subtotalUsd,
        total_price_cdf: subtotalCdf,
        is_vehicle: isVehicle,
        requires_manual_quote: isVehicle,
        is_saved_for_later: false,
      };

      if (existingItem) {
        // Update existing (idempotent)
        const { error: updateError } = await supabase
          .from('order_items')
          .update(itemData)
          .eq('id', existingItem.id);

        if (updateError) {
          console.error(`[${requestId}] Failed to update item:`, updateError.message);
        } else {
          mergedCount++;
        }
      } else {
        // Insert new - use .select('id').single() to get the real ID
        const { data: insertedItem, error: insertError } = await supabase
          .from('order_items')
          .insert(itemData)
          .select('id')
          .single();

        if (insertError) {
          console.error(`[${requestId}] Failed to insert item:`, insertError.message);
        } else {
          mergedCount++;
          // Store the REAL inserted ID to prevent duplicates in same batch
          existingByUrl.set(normalizedUrl, { id: insertedItem.id, hasQuote: false });
        }
      }
    }

    // Recalculate order totals
    const { data: allItems } = await supabase
      .from('order_items')
      .select('subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf, requires_manual_quote')
      .eq('order_id', draftOrder.id)
      .eq('is_saved_for_later', false);

    let itemTotalUsd = 0;
    let totalMarginUsd = 0;
    let totalUsd = 0;
    let totalCdf = 0;
    let requiresManualQuote = false;

    (allItems || []).forEach((item: any) => {
      itemTotalUsd += Number(item.subtotal_usd) || 0;
      totalMarginUsd += Number(item.markup_fee_usd) || 0;
      totalUsd += Number(item.total_price_usd) || 0;
      totalCdf += Number(item.total_price_cdf) || 0;
      if (item.requires_manual_quote) requiresManualQuote = true;
    });

    // Add shipping - shippingPercent is already normalized to decimal (0.10)
    const shippingFeeUsd = Math.round((shippingBaseFee + (itemTotalUsd * shippingPercent)) * 100) / 100;
    const grandTotalUsd = Math.round((totalUsd + shippingFeeUsd) * 100) / 100;
    const grandTotalCdf = Math.round(grandTotalUsd * exchangeRate);
    
    console.log(`[${requestId}] Shipping calc:`, {
      itemTotalUsd,
      shippingBaseFee,
      shippingPercent,
      shippingPercentContribution: Math.round(itemTotalUsd * shippingPercent * 100) / 100,
      shippingFeeUsd,
    });

    // Update order totals
    await supabase
      .from('orders')
      .update({
        item_total_usd: itemTotalUsd,
        service_fee_usd: totalMarginUsd,
        shipping_fee_usd: shippingFeeUsd,
        total_usd: grandTotalUsd,
        total_cdf: grandTotalCdf,
        exchange_rate_used: exchangeRate,
        requires_manual_quote: requiresManualQuote,
        cart_version: (draftOrder.cart_version || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draftOrder.id);

    console.log(`[${requestId}] Merge complete: ${mergedCount} merged, ${skippedCount} skipped`);

    return new Response(
      JSON.stringify({
        success: true,
        merged_count: mergedCount,
        skipped_count: skippedCount,
        deduped_from: guestItems.length,
        deduped_to: dedupedGuestItems.length,
        cart_id: draftOrder.id,
        totals: {
          item_total_usd: itemTotalUsd,
          shipping_fee_usd: shippingFeeUsd,
          total_usd: grandTotalUsd,
          total_cdf: grandTotalCdf,
          requires_manual_quote: requiresManualQuote,
        },
        // DEBUG: Shipping calculation details for mobile debugging
        shipping_debug: {
          shipping_percent_raw: rawShippingPercent,
          shipping_percent_used: shippingPercent,
          shipping_calc_mode: shippingCalcMode,
          shipping_base_fee: shippingBaseFee,
          shipping_percent_contribution: Math.round(itemTotalUsd * shippingPercent * 100) / 100,
        },
        message: mergedCount > 0 
          ? `Successfully merged ${mergedCount} item(s) into your cart`
          : 'All items already in cart',
        requestId,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${requestId}] Unexpected error:`, error?.message || error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        code: 'INTERNAL_ERROR', 
        message: 'An unexpected error occurred. Your cart items are safe - please try again.',
        requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
