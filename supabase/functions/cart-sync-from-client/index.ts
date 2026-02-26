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
import { determineShippingCategory } from "../_shared/shippingCategory.ts";
import { isBlockedImageUrl } from "../_shared/imageValidation.ts";

// Input validation schema
/**
 * CRITICAL: Normalize an image URL to be a valid absolute https URL for React Native.
 * Also checks against blocklist to filter out generic logos.
 * Handles:
 * - Protocol-relative URLs: //cdn.example.com/image.jpg -> https://cdn.example.com/image.jpg
 * - Relative URLs: /images/product.jpg -> https://origin.com/images/product.jpg
 * - Blocklist filtering for generic logos (Amazon logo, placeholders, etc.)
 * - Whitespace trimming
 * - Validation via URL constructor
 */
function normalizeImageUrl(raw: unknown, productUrl?: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;

  // Ignore non-web URIs
  if (s.startsWith("data:") || s.startsWith("blob:")) return null;

  // Protocol-relative → https
  if (s.startsWith("//")) {
    s = "https:" + s;
    console.log("[IMAGE_NORMALIZE] protocol-relative fixed:", s.substring(0, 60));
  }

  // Relative path → resolve against product URL origin (if available)
  if (s.startsWith("/") || (!s.startsWith("http://") && !s.startsWith("https://"))) {
    if (productUrl) {
      try {
        const base = new URL(productUrl);
        s = new URL(s, base.origin).toString();
        console.log("[IMAGE_NORMALIZE] relative path resolved:", s.substring(0, 60));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  // Final validation
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    
    const validatedUrl = u.toString();
    
    // CRITICAL: Check against blocklist to filter out generic logos
    if (isBlockedImageUrl(validatedUrl)) {
      console.log('[cart-sync-from-client] Blocked generic image:', validatedUrl.substring(0, 60));
      return null;
    }
    
    return validatedUrl;
  } catch {
    return null;
  }
}

// COMPATIBILITY: Helper to coalesce multiple possible image field names
function coalesceImageUrl(item: any): { imageUrl: string | null; incomingKeys: string[] } {
  const incomingKeys: string[] = [];
  if (item.productImageUrl) incomingKeys.push('productImageUrl');
  if (item.image_url) incomingKeys.push('image_url');
  if (item.imageUrl) incomingKeys.push('imageUrl');
  if (item.product_image_url) incomingKeys.push('product_image_url');
  if (item.thumbnail) incomingKeys.push('thumbnail');
  if (item.photo) incomingKeys.push('photo');
  if (item.picture) incomingKeys.push('picture');
  if (item.productImage) incomingKeys.push('productImage');
  if (item.image) incomingKeys.push('image');
  
  const rawImageUrl = 
    item.productImageUrl ?? 
    item.image_url ?? 
    item.imageUrl ?? 
    item.product_image_url ??
    item.thumbnail ??
    item.photo ??
    item.picture ??
    item.productImage ??
    item.image ??
    null;
  
  // CRITICAL: Use normalizeImageUrl for protocol-relative and relative URLs
  const productUrl = item.productUrl ?? item.product_url ?? null;
  const normalizedUrl = normalizeImageUrl(rawImageUrl, productUrl);
  
  return { imageUrl: normalizedUrl, incomingKeys };
}

const syncCartSchema = z.object({
  items: z.array(z.object({
    id: z.string().optional(), // Local item ID (ignored)
    productUrl: z.string().url().max(2048),
    title: z.string().max(500).optional(),
    // Accept all possible image field names (validated later via coalesceImageUrl)
    imageUrl: z.string().max(2048).optional().nullable(),
    image_url: z.string().max(2048).optional().nullable(),
    productImageUrl: z.string().max(2048).optional().nullable(),
    product_image_url: z.string().max(2048).optional().nullable(),
    thumbnail: z.string().max(2048).optional().nullable(),
    photo: z.string().max(2048).optional().nullable(),
    picture: z.string().max(2048).optional().nullable(),
    productImage: z.string().max(2048).optional().nullable(),
    image: z.string().max(2048).optional().nullable(),
    store: z.string().max(50).optional(),
    unitPrice: z.number().positive().max(1000000),
    quantity: z.number().int().positive().max(100).default(1),
    currency: z.string().max(10).optional().default('USD'),
    // Top-level price confirmation fields (mobile app format)
    price_source: z.string().optional(),
    priceSource: z.string().optional(),
    price_confirmation_status: z.string().optional(),
    priceConfirmationStatus: z.string().optional(),
    proposed_price_usd: z.number().optional(),
    proposedPriceUsd: z.number().optional(),
    captured_price_usd: z.number().optional(),
    capturedPriceUsd: z.number().optional(),
    priceEdited: z.union([z.boolean(), z.string()]).optional(),
    manual_price: z.union([z.boolean(), z.string()]).optional(),
    // Meta fields for price confirmation detection (nested format)
    meta: z.object({
      priceEdited: z.boolean().optional(),
      capturedPrice: z.number().optional(),
      capturedPriceUsd: z.number().optional(),
      originalPriceUsd: z.number().optional(),
      price_confirmation_status: z.string().optional(),
      priceConfirmationStatus: z.string().optional(),
      price_source: z.string().optional(),
      priceSource: z.string().optional(),
    }).optional(),
  })).max(50), // Max 50 items per sync
}).passthrough();

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
      const errorMessage = (parseResult as any).error?.errors?.map((e: any) => e.message).join(', ') || 'Validation failed';
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
      
      // Detect vehicle items using smart category detection (handles eBay, Amazon, etc.)
      const vehicleDetection = determineShippingCategory({
        title: item.title || "",
        url: item.productUrl,
        store: store,
        existingCategory: null,
      });
      const isVehicle = vehicleDetection.category === "vehicle" && vehicleDetection.requiresQuote;
      
      // Detect if price was edited by user (requires admin confirmation)
      // Support BOTH top-level fields (mobile app) AND nested meta fields (web)
      const meta = item.meta || {};
      
      // Check all possible price_source locations (case-insensitive)
      const priceSourceTop = String(item.price_source ?? item.priceSource ?? "").toLowerCase();
      const priceSourceMeta = String(meta.price_source ?? meta.priceSource ?? "").toLowerCase();
      const isManualSource = 
        priceSourceTop === "manual_user" || priceSourceTop === "manual" ||
        priceSourceMeta === "manual_user" || priceSourceMeta === "manual";
      
      // Check price_confirmation_status (if explicitly set to 'pending' by frontend)
      const confirmStatus = String(
        item.price_confirmation_status ?? item.priceConfirmationStatus ??
        meta.price_confirmation_status ?? meta.priceConfirmationStatus ?? ""
      ).toLowerCase();
      const isPendingFromFrontend = confirmStatus === "pending";
      
      // Check explicit boolean flags (top-level and meta)
      const priceEditedFlag = 
        item.priceEdited === true ||
        String(item.priceEdited ?? "").toLowerCase() === "true" ||
        item.manual_price === true ||
        String(item.manual_price ?? "").toLowerCase() === "true" ||
        meta.priceEdited === true;
      
      // Get captured price from ALL possible locations
      const capturedPrice = 
        item.captured_price_usd ?? item.capturedPriceUsd ??
        meta.capturedPrice ?? meta.capturedPriceUsd ?? null;
      
      // Price difference detection (only if capturedPrice exists)
      const hasPriceDifference = capturedPrice !== null && 
        Math.abs(item.unitPrice - Number(capturedPrice)) > 0.01;
      
      const priceEdited = 
        isManualSource ||
        isPendingFromFrontend ||
        priceEditedFlag ||
        meta.originalPriceUsd !== undefined ||
        hasPriceDifference;
      
      console.log('[PRICE_CONFIRM] sync item detection:', {
        priceEdited,
        isManualSource,
        isPendingFromFrontend,
        priceEditedFlag,
        hasPriceDifference,
        unitPrice: item.unitPrice,
        capturedPrice,
        priceSourceTop,
        priceSourceMeta,
        confirmStatus,
      });
      
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
      
      // COMPATIBILITY: Coalesce all possible image field names with logging
      const { imageUrl: resolvedImageUrl, incomingKeys } = coalesceImageUrl(item);
      
      console.log('[CART_IMAGE] fn=cart-sync-from-client incomingKeys=' + incomingKeys.join(',') + ' chosen=' + (resolvedImageUrl ? resolvedImageUrl.substring(0, 60) + '...' : 'null') + ' saved=' + (resolvedImageUrl ? 'true' : 'false'));
      
      const itemData: Record<string, any> = {
        order_id: cartId,
        product_url: item.productUrl,
        title: item.title || null,
        product_image_url: resolvedImageUrl,
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
      let priceConfirmationId: string | null = null;
      if (priceEdited) {
        itemData.price_confirmation_status = 'PENDING';
        
        // Create price_confirmations record for admin panel
        const capturedPrice = meta.capturedPrice || meta.capturedPriceUsd || null;
        const { data: priceConfirmation, error: pcError } = await supabase
          .from('price_confirmations')
          .insert({
            user_id: user.id,
            product_url: item.productUrl,
            store: store,
            proposed_price: item.unitPrice,
            proposed_currency: (item.currency || 'USD').toUpperCase(),
            extracted_price: capturedPrice,
            extracted_currency: capturedPrice ? (item.currency || 'USD').toUpperCase() : null,
            extraction_source: capturedPrice ? 'structured' : 'manual',
            extraction_confidence: capturedPrice ? 0.8 : null,
            status: 'PENDING',
          })
          .select('id')
          .single();
        
        if (pcError) {
          console.error('[cart-sync-from-client] Failed to create price_confirmations:', pcError);
        } else {
          console.log('[cart-sync-from-client] Created price_confirmations:', priceConfirmation.id);
          priceConfirmationId = priceConfirmation.id;
          itemData.price_confirmation_id = priceConfirmationId;
        }
        
        // Create admin notification for price review
        await supabase
          .from('admin_notifications')
          .insert({
            type: 'PRICE_REVIEW',
            title: 'Price Review Required',
            body: `User submitted manual price: $${item.unitPrice.toFixed(2)} for ${item.title || item.productUrl}`,
            payload: {
              user_id: user.id,
              product_url: item.productUrl,
              title: item.title,
              captured_price: capturedPrice,
              user_price: item.unitPrice,
              currency: item.currency || 'USD',
              price_confirmation_id: priceConfirmationId,
            },
          });
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
