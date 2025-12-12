import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { 
  handleCors, 
  errorResponse, 
  jsonResponse,
  extractBearerToken,
  createAdminClient,
} from "../_shared/auth.ts";
import { getCachedSettings } from "../_shared/settings-cache.ts";
import { 
  calculateItemPricing, 
  detectStore, 
  updateOrderTotals 
} from "../_shared/cartHelpers.ts";

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

    // Load cached pricing settings
    const settings = await getCachedSettings(supabase);
    const { markupPercent, exchangeRate, shippingBaseFeeUsd, shippingPercent } = settings;

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
    // Return structured error - NEVER delete cart on transient errors
    return jsonResponse({ 
      ok: false, 
      success: false,
      code: 'TEMPORARY_ERROR', 
      message: 'Temporary problem syncing cart. Please try again.' 
    }, 500);
  }
});
