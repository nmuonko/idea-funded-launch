import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  handleCors, 
  corsHeaders, 
  errorResponse, 
  jsonResponse,
  extractBearerToken,
  createAdminClient,
} from "../_shared/auth.ts";

// Input validation schema
const syncCartSchema = z.object({
  items: z.array(z.object({
    id: z.string().optional(), // Local item ID (ignored)
    productUrl: z.string().url().max(2048),
    title: z.string().max(500).optional(),
    imageUrl: z.string().url().max(2048).optional().nullable(),
    store: z.string().max(50).optional(),
    unitPrice: z.number().positive().max(1000000),
    quantity: z.number().int().positive().max(100).default(1),
    currency: z.string().max(10).optional().default('USD'),
  })).max(50), // Max 50 items per sync
});

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

// Calculate pricing for an item
function calculateItemPricing(
  basePriceUsd: number,
  quantity: number,
  markupPercent: number,
  exchangeRate: number
) {
  const itemBaseTotalUsd = round2(basePriceUsd * quantity);
  const itemMarginUsd = round2(itemBaseTotalUsd * (markupPercent / 100));
  const itemSubtotalUsd = round2(itemBaseTotalUsd + itemMarginUsd);
  const itemSubtotalCdf = round2(itemSubtotalUsd * exchangeRate);

  return {
    basePriceUsd: round2(basePriceUsd),
    quantity,
    itemBaseTotalUsd,
    itemMarginUsd,
    itemSubtotalUsd,
    itemSubtotalCdf,
  };
}

// Detect store from URL
function detectStore(productUrl: string): string {
  try {
    const urlObj = new URL(productUrl);
    const hostname = urlObj.hostname.toLowerCase();
    if (hostname.includes('amazon')) return 'AMAZON';
    if (hostname.includes('ebay')) return 'EBAY';
    if (hostname.includes('walmart')) return 'WALMART';
    if (hostname.includes('bestbuy')) return 'BESTBUY';
    if (hostname.includes('carvana')) return 'CARVANA';
    if (hostname.includes('cargurus')) return 'CARGURUS';
    return 'OTHER';
  } catch {
    return 'OTHER';
  }
}

// Calculate and persist order totals from items
async function updateOrderTotals(
  supabase: any,
  orderId: string,
  shippingBaseFeeUsd: number,
  shippingPercent: number,
  exchangeRate: number
) {
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('subtotal_usd, markup_fee_usd, total_price_usd, quantity, est_weight_kg, requires_manual_quote, is_saved_for_later')
    .eq('order_id', orderId);

  if (itemsError) {
    console.error('[updateOrderTotals] Failed to fetch items:', itemsError);
    return null;
  }

  let itemTotalUsd = 0;
  let serviceFeeUsd = 0;
  let itemsWithMarkupUsd = 0;
  let requiresManualQuote = false;
  let activeItemCount = 0;

  (items || []).forEach((item: any) => {
    if (!item.is_saved_for_later) {
      const subtotal = Number(item.subtotal_usd || 0);
      const markup = Number(item.markup_fee_usd || 0);
      const total = Number(item.total_price_usd || 0);
      const estWeight = Number(item.est_weight_kg || 1);
      const itemRequiresQuote = item.requires_manual_quote || estWeight > 9;

      itemTotalUsd += subtotal;
      serviceFeeUsd += markup;
      itemsWithMarkupUsd += total;
      activeItemCount++;

      if (itemRequiresQuote) {
        requiresManualQuote = true;
      }
    }
  });

  let shippingFeeUsd = 0;
  if (!requiresManualQuote && activeItemCount > 0) {
    shippingFeeUsd = round2(shippingBaseFeeUsd + (itemTotalUsd * shippingPercent));
  }
  
  const totalUsd = round2(itemsWithMarkupUsd + shippingFeeUsd);
  const totalCdf = round2(totalUsd * exchangeRate);

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      item_total_usd: round2(itemTotalUsd),
      service_fee_usd: round2(serviceFeeUsd),
      shipping_fee_usd: round2(shippingFeeUsd),
      total_usd: totalUsd,
      total_cdf: totalCdf,
      exchange_rate_used: exchangeRate,
      requires_manual_quote: requiresManualQuote,
    })
    .eq('id', orderId);

  if (updateError) {
    console.error('[updateOrderTotals] Failed to update order totals:', updateError);
    return null;
  }

  return {
    itemTotalUsd: round2(itemTotalUsd),
    serviceFeeUsd: round2(serviceFeeUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    totalUsd,
    totalCdf,
    exchangeRate,
    requiresManualQuote,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Require authentication - guests get 401
    const authHeader = req.headers.get('Authorization');
    const token = extractBearerToken(authHeader);
    
    if (!token) {
      console.log('[cart-sync-from-client] No auth token - returning 401 for guest');
      return errorResponse('Authentication required. Please login to sync cart.', 401);
    }

    const supabase = createAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.log('[cart-sync-from-client] Invalid token:', authError?.message);
      return errorResponse('Invalid or expired session. Please login again.', 401);
    }

    console.log('[cart-sync-from-client] User authenticated:', user.id);

    // Parse and validate input
    const body = await req.json();
    const parseResult = syncCartSchema.safeParse(body);
    
    if (!parseResult.success) {
      const errorMessage = parseResult.error.errors.map(e => e.message).join(', ');
      console.log('[cart-sync-from-client] Validation error:', errorMessage);
      return errorResponse(errorMessage, 400);
    }

    const { items } = parseResult.data;

    if (items.length === 0) {
      return errorResponse('No items to sync', 400);
    }

    console.log('[cart-sync-from-client] Syncing', items.length, 'items for user:', user.id);

    // Load pricing settings
    const { data: settings } = await supabase.from('settings').select('*').maybeSingle();
    
    if (!settings) {
      console.error('[cart-sync-from-client] No settings found');
      return errorResponse('Pricing settings not configured', 500);
    }

    const markupPercent = settings.markup_percent ?? settings.global_markup_percent ?? 15;
    const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 2800;
    const shippingBaseFeeUsd = settings.shipping_base_fee_usd ?? 20;
    const shippingPercent = settings.shipping_percent ?? 0.10;

    // Find existing DRAFT order for this user
    const { data: existingDraft, error: draftError } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    if (draftError) {
      console.error('[cart-sync-from-client] Error finding draft:', draftError);
      return errorResponse('Failed to access cart', 500);
    }

    let cartId: string;

    if (existingDraft) {
      cartId = existingDraft.id;
      console.log('[cart-sync-from-client] Found existing DRAFT order:', cartId);
    } else {
      // Create new DRAFT order
      const { data: newOrder, error: createError } = await supabase
        .from('orders')
        .insert({
          user_id: user.id,
          status: 'DRAFT',
          item_total_usd: 0,
          service_fee_usd: 0,
          shipping_fee_usd: 0,
          total_usd: 0,
          total_cdf: 0,
          exchange_rate_used: exchangeRate,
        })
        .select('id')
        .single();

      if (createError || !newOrder) {
        console.error('[cart-sync-from-client] Failed to create DRAFT order:', createError);
        return errorResponse('Failed to create cart', 500);
      }

      cartId = newOrder.id;
      console.log('[cart-sync-from-client] Created new DRAFT order:', cartId);
    }

    // Get existing items for this cart
    const { data: existingItems } = await supabase
      .from('order_items')
      .select('id, product_url')
      .eq('order_id', cartId);

    const existingItemsByUrl = new Map<string, string>();
    (existingItems || []).forEach((item: any) => {
      existingItemsByUrl.set(item.product_url, item.id);
    });

    // Upsert items
    const syncedItems: any[] = [];
    
    for (const item of items) {
      const store = item.store?.toUpperCase() || detectStore(item.productUrl);
      const pricing = calculateItemPricing(item.unitPrice, item.quantity, markupPercent, exchangeRate);
      
      const itemData = {
        order_id: cartId,
        product_url: item.productUrl,
        title: item.title || null,
        product_image_url: item.imageUrl || null,
        store: store,
        base_price_usd: pricing.basePriceUsd,
        unit_price_usd: pricing.basePriceUsd,
        quantity: pricing.quantity,
        subtotal_usd: pricing.itemBaseTotalUsd,
        markup_fee_usd: pricing.itemMarginUsd,
        total_price_usd: pricing.itemSubtotalUsd,
        total_price_cdf: pricing.itemSubtotalCdf,
        est_weight_kg: 1,
        is_saved_for_later: false,
        requires_manual_quote: false,
      };

      const existingItemId = existingItemsByUrl.get(item.productUrl);

      if (existingItemId) {
        // Update existing item
        const { data: updated, error: updateError } = await supabase
          .from('order_items')
          .update(itemData)
          .eq('id', existingItemId)
          .select('id, product_url, title, product_image_url, store, base_price_usd, quantity, subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf')
          .single();

        if (updateError) {
          console.error('[cart-sync-from-client] Failed to update item:', updateError);
        } else {
          syncedItems.push(updated);
        }
      } else {
        // Insert new item
        const { data: inserted, error: insertError } = await supabase
          .from('order_items')
          .insert(itemData)
          .select('id, product_url, title, product_image_url, store, base_price_usd, quantity, subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf')
          .single();

        if (insertError) {
          console.error('[cart-sync-from-client] Failed to insert item:', insertError);
        } else {
          syncedItems.push(inserted);
        }
      }
    }

    // Recalculate order totals
    const totals = await updateOrderTotals(
      supabase,
      cartId,
      shippingBaseFeeUsd,
      shippingPercent,
      exchangeRate
    );

    console.log('[cart-sync-from-client] Sync complete:', {
      cartId,
      itemsSynced: syncedItems.length,
      totals,
    });

    // Return response matching expected format
    return jsonResponse({
      success: true,
      cartId: cartId,
      cart: {
        id: cartId,
        userId: user.id,
        status: 'DRAFT',
        items: syncedItems.map(item => ({
          id: item.id,
          productUrl: item.product_url,
          title: item.title,
          imageUrl: item.product_image_url,
          store: item.store,
          unitPrice: Number(item.base_price_usd),
          quantity: item.quantity,
          subtotal: Number(item.subtotal_usd),
          markupFee: Number(item.markup_fee_usd),
          totalUsd: Number(item.total_price_usd),
          totalCdf: Number(item.total_price_cdf),
        })),
        totals: totals ? {
          itemsTotal: totals.itemTotalUsd,
          markupFee: totals.serviceFeeUsd,
          shippingFee: totals.shippingFeeUsd,
          totalUsd: totals.totalUsd,
          totalCdf: totals.totalCdf,
          exchangeRate: totals.exchangeRate,
          requiresManualQuote: totals.requiresManualQuote,
        } : null,
      },
    });

  } catch (error: any) {
    console.error('[cart-sync-from-client] Unexpected error:', error);
    return errorResponse(error.message || 'Internal server error', 500);
  }
});
