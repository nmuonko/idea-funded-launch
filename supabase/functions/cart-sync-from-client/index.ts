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
  updateOrderTotals,
  isVehicleItem,
  normalizeProductUrl,
  getOrCreateSingleDraftOrder,
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
    // Meta fields for price confirmation detection
    meta: z.object({
      priceEdited: z.boolean().optional(),
      capturedPrice: z.number().optional(),
      capturedPriceUsd: z.number().optional(),
      originalPriceUsd: z.number().optional(),
      price_confirmation_status: z.string().optional(),
      priceConfirmationStatus: z.string().optional(),
    }).optional(),
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
    const { markupPercent, vehicleMarkupPercent, exchangeRate, shippingBaseFeeUsd, shippingPercent } = settings;

    // ENFORCE SINGLE DRAFT ORDER: Get or create, merging duplicates
    const { cartId, created } = await getOrCreateSingleDraftOrder(supabase, user.id, exchangeRate);
    console.log('[cart-sync-from-client]', created ? 'Created new' : 'Using existing', 'DRAFT order:', cartId);

    // Get existing items for this cart
    const { data: existingItems } = await supabase
      .from('order_items')
      .select('id, product_url, is_vehicle, vehicle_quote_applied')
      .eq('order_id', cartId);

    // Map by NORMALIZED URL to prevent duplicates with different query params
    // e.g., tesla.com/inventory/used/ms?PaymentType=lease === tesla.com/inventory/used/ms
    const existingItemsByNormalizedUrl = new Map<string, { id: string; hasQuote: boolean }>();
    (existingItems || []).forEach((item: any) => {
      const normalizedUrl = normalizeProductUrl(item.product_url);
      // If item already has a vehicle quote applied, DON'T overwrite it
      const existing = existingItemsByNormalizedUrl.get(normalizedUrl);
      if (!existing || (item.vehicle_quote_applied && !existing.hasQuote)) {
        existingItemsByNormalizedUrl.set(normalizedUrl, { 
          id: item.id, 
          hasQuote: item.vehicle_quote_applied === true 
        });
      }
    });
    
    console.log('[cart-sync-from-client] Existing items by normalized URL:', 
      Array.from(existingItemsByNormalizedUrl.entries()).map(([url, data]) => ({ url, ...data }))
    );

    // Upsert items
    const syncedItems: any[] = [];
    
    for (const item of items) {
      const store = item.store?.toUpperCase() || detectStore(item.productUrl);
      
      // Detect vehicle items (Tesla inventory, car marketplaces, etc.)
      const isVehicle = isVehicleItem(item.productUrl, store);
      
      // Detect if price was edited by user (requires admin confirmation)
      const meta = item.meta || {};
      const priceEdited = 
        meta.priceEdited === true ||
        meta.originalPriceUsd !== undefined ||
        meta.capturedPriceUsd !== undefined ||
        (meta.capturedPrice !== undefined && Math.abs(item.unitPrice - Number(meta.capturedPrice)) > 0.01) ||
        (meta.capturedPriceUsd !== undefined && Math.abs(item.unitPrice - Number(meta.capturedPriceUsd)) > 0.01);
      
      console.log('[PRICE_CONFIRM] edited=', priceEdited, 'price=', item.unitPrice, 'captured=', meta.capturedPrice || meta.capturedPriceUsd);
      
      // Use vehicle markup for vehicles, general markup for everything else
      const pricing = calculateItemPricing(
        item.unitPrice, 
        item.quantity, 
        markupPercent, 
        exchangeRate,
        isVehicle,
        vehicleMarkupPercent
      );
      
      if (isVehicle) {
        console.log('[cart-sync-from-client] Vehicle item detected:', { 
          url: item.productUrl, 
          store,
          markupUsed: vehicleMarkupPercent 
        });
      }
      
      const itemData: Record<string, any> = {
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
        // Set vehicle flags based on detection
        is_vehicle: isVehicle,
        requires_manual_quote: isVehicle,
      };
      
      // Force PENDING if user edited the price
      if (priceEdited) {
        itemData.price_confirmation_status = 'PENDING';
      }

      // Use NORMALIZED URL for duplicate detection
      const normalizedUrl = normalizeProductUrl(item.productUrl);
      const existingItem = existingItemsByNormalizedUrl.get(normalizedUrl);

      if (existingItem) {
        // CRITICAL: If item already has a vehicle quote applied, don't overwrite pricing
        if (existingItem.hasQuote) {
          console.log('[cart-sync-from-client] Skipping update - vehicle quote already applied:', normalizedUrl);
          // Fetch the existing item to include in response
          const { data: existing } = await supabase
            .from('order_items')
            .select('id, product_url, title, product_image_url, store, base_price_usd, quantity, subtotal_usd, markup_fee_usd, total_price_usd, total_price_cdf')
            .eq('id', existingItem.id)
            .single();
          if (existing) {
            syncedItems.push(existing);
          }
          continue;
        }
        
        // Update existing item (no quote applied yet)
        const { data: updated, error: updateError } = await supabase
          .from('order_items')
          .update(itemData)
          .eq('id', existingItem.id)
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
          // Add to map to prevent duplicates within same sync call
          existingItemsByNormalizedUrl.set(normalizedUrl, { id: inserted.id, hasQuote: false });
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
    console.error('[cart-sync-from-client] Unexpected error:', error?.message || error);
    
    // Check for specific error types
    const errorMessage = error?.message || '';
    
    // Database connection errors
    if (errorMessage.includes('connection') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      return jsonResponse({ 
        ok: false, 
        success: false,
        code: 'DB_CONNECTION_ERROR', 
        message: 'Unable to connect to server. Please check your internet connection.' 
      }, 503);
    }
    
    // Auth errors
    if (error?.name === 'AuthError' || errorMessage.includes('JWT')) {
      return jsonResponse({ 
        ok: false, 
        success: false,
        code: 'AUTH_ERROR', 
        message: 'Session expired. Please login again.' 
      }, 401);
    }
    
    // Return structured error - NEVER delete cart on transient errors
    return jsonResponse({ 
      ok: false, 
      success: false,
      code: 'TEMPORARY_ERROR', 
      message: 'Temporary problem syncing cart. Please try again.' 
    }, 500);
  }
});
