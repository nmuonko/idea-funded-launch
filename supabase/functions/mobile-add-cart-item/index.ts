/**
 * Mobile Add Cart Item - Lean Orchestrator
 * 
 * POST /mobile-add-cart-item
 * 
 * Adds a product to the user's cart (DRAFT order).
 * Uses modular cart modules for validation, pricing, images, and DB ops.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  handleCors, 
  corsHeaders, 
  errorResponse, 
  jsonResponse,
  extractBearerToken,
  getDbClient,
  createAdminPostgrestClient,
  createAdminClient,
} from "../_shared/auth.ts";
import { PostgrestClient } from "../_shared/postgrest.ts";
import {
  validateAddCartItemInput,
  isUserEditedPrice,
  coalesceImageUrl,
  normalizeImageUrl,
  detectStore,
} from "../_shared/cart/validate.ts";
import {
  calculateItemPricing,
  calculateShippingFee,
  buildItemResponse,
  round2,
} from "../_shared/cart/pricing.ts";
import {
  scrapeProductInfo,
  getImageFromCache,
  validateImageUrl,
} from "../_shared/cart/images.ts";
import {
  getOrCreateDraftOrder,
  findExistingCartItem,
  updateCartItem,
  insertCartItem,
  getShippingType,
  getShippingTypeForCategory,
  getCachedSettings,
} from "../_shared/cart/db.ts";
import {
  determineShippingCategory,
  type ShippingCategoryKey,
} from "../_shared/shippingCategory.ts";
import { updateOrderTotals as sharedUpdateOrderTotals } from "../_shared/cartHelpers.ts";

// Generate correlation ID for logging
function generateCorrelationId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// Get user from token (optional auth - guests allowed)
async function optionallyGetUser(
  db: PostgrestClient,
  authHeader: string | null,
  correlationId: string
): Promise<{ userId: string | null; error: string | null }> {
  const token = extractBearerToken(authHeader);
  
  if (!token) {
    console.log(`[CART_ADD] ${correlationId} No auth token - guest mode`);
    return { userId: null, error: null };
  }
  
  const result = await db.getUser(token);
  
  if (result.error || !result.data?.user) {
    console.log(`[CART_ADD] ${correlationId} Invalid token - guest mode`);
    return { userId: null, error: null };
  }
  
  const userId = (result.data.user as { id: string }).id;
  console.log(`[CART_ADD] ${correlationId} User authenticated: ${userId.slice(0, 8)}...`);
  return { userId, error: null };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  
  const correlationId = generateCorrelationId();
  const startTime = Date.now();
  
  try {
    // Get admin DB client (bypasses RLS)
    const db = createAdminPostgrestClient();
    
    // Optional auth - guests allowed for price calculation
    const authHeader = req.headers.get("Authorization");
    const { userId, error: authError } = await optionallyGetUser(db, authHeader, correlationId);
    
    if (authError) {
      return errorResponse(authError, 401);
    }
    
    const isGuest = userId === null;
    console.log(`[CART_ADD] ${correlationId} Mode: ${isGuest ? "GUEST" : "AUTHENTICATED"}`);
    
    // Parse and validate input
    const body = await req.json();
    
    // Coalesce image URL from multiple possible field keys
    const rawImageUrl = coalesceImageUrl(body);
    const coalescedImageUrl = normalizeImageUrl(rawImageUrl, body.productUrl);
    body.productImageUrl = coalescedImageUrl ?? undefined;
    
    console.log(`[CART_ADD] ${correlationId} Image coalesced: ${coalescedImageUrl ? coalescedImageUrl.substring(0, 50) + "..." : "null"}`);
    
    const validation = validateAddCartItemInput(body);
    if (validation.error) {
      console.log(`[CART_ADD] ${correlationId} Validation failed: ${validation.error}`);
      return errorResponse(validation.error, 400);
    }
    
    const { 
      productUrl, 
      productPrice, 
      quantity, 
      shippingItemTypeId, 
      productTitle: inputTitle, 
      productImageUrl: inputImageUrl 
    } = validation.data;
    
    const deviceId = body.deviceId ?? body.device_id ?? null;
    const userEdited = isUserEditedPrice(body);
    
    console.log(`[CART_ADD] ${correlationId} Request: url=${productUrl.substring(0, 50)}... price=${productPrice} qty=${quantity} userEdited=${userEdited}`);
    
    // Block manual price for guests
    if (userEdited && isGuest) {
      console.log(`[CART_ADD] ${correlationId} BLOCKED: Guest manual price submission`);
      return jsonResponse({
        ok: false,
        code: "AUTH_REQUIRED_FOR_MANUAL_PRICE",
        error: "Authentication required to submit modified prices.",
      }, 401);
    }
    
    // Load settings
    const settingsResult = await getCachedSettings(db, correlationId);
    if (settingsResult.error || !settingsResult.data) {
      return errorResponse("Failed to load settings", 500);
    }
    const settings = settingsResult.data;
    
    console.log(`[CART_ADD] ${correlationId} Settings: markup=${settings.markupPercent}% vehicleMarkup=${settings.vehicleMarkupPercent}% rate=${settings.exchangeRate}`);
    
    // Determine effective markup — will be refined after vehicle detection below
    // For now use general; recalculate if vehicle detected
    let effectiveMarkup = settings.markupPercent;
    
    // Calculate pricing (initial — may be recalculated for vehicles)
    let pricing = calculateItemPricing(
      productPrice,
      quantity,
      effectiveMarkup,
      settings.exchangeRate
    );
    
    // Detect store
    const store = detectStore(productUrl);
    
    // Get product image and title
    let productTitle = inputTitle ?? null;
    let productImageUrl = inputImageUrl ?? null;
    
    if (!productImageUrl || !productTitle) {
      // Try scraping
      const scraped = await scrapeProductInfo(productUrl, correlationId);
      if (!productImageUrl && scraped.imageUrl) productImageUrl = scraped.imageUrl;
      if (!productTitle && scraped.title) productTitle = scraped.title;
    }
    
    if (!productImageUrl) {
      // Fallback to cache
      const cached = await getImageFromCache(db, productUrl, correlationId);
      if (!productImageUrl && cached.imageUrl) productImageUrl = cached.imageUrl;
      if (!productTitle && cached.title) productTitle = cached.title;
    }
    
    // Auto-detect shipping category
    let estWeightKg = 1;
    let requiresManualQuote = false;
    let isVehicle = false;
    let finalShippingTypeId = shippingItemTypeId ?? null;
    
    // Check if manual shipping type provided
    if (shippingItemTypeId) {
      const typeResult = await getShippingType(db, shippingItemTypeId, correlationId);
      if (typeResult.data) {
        estWeightKg = typeResult.data.estWeightKg;
      }
    }
    
    // Auto-detect category
    const detection = determineShippingCategory({
      title: productTitle || "",
      url: productUrl,
      store: store,
      existingCategory: null,
    });
    
    console.log(`[CART_ADD] ${correlationId} Category: ${detection.category} confidence=${detection.confidence} requiresQuote=${detection.requiresQuote}`);
    
    if (detection.category === "vehicle" && detection.requiresQuote) {
      isVehicle = true;
      requiresManualQuote = true;
      finalShippingTypeId = null;
      
      // Recalculate pricing with vehicle-specific markup
      effectiveMarkup = settings.vehicleMarkupPercent;
      pricing = calculateItemPricing(
        productPrice,
        quantity,
        effectiveMarkup,
        settings.exchangeRate
      );
      console.log(`[CART_ADD] ${correlationId} Vehicle detected — using vehicle markup ${effectiveMarkup}%`);
    } else if (detection.category && detection.category !== "vehicle") {
      const catTypeResult = await getShippingTypeForCategory(db, detection.category, correlationId);
      if (catTypeResult.data) {
        finalShippingTypeId = catTypeResult.data.id;
        estWeightKg = catTypeResult.data.estWeightKg;
      }
    }
    
    // Calculate shipping
    const shippingFeeUsd = calculateShippingFee(
      pricing.itemBaseTotalUsd,
      settings.shippingBaseFeeUsd,
      settings.shippingPercent,
      requiresManualQuote
    );
    
    // Guest mode: return price calculation only
    if (isGuest) {
      console.log(`[CART_ADD] ${correlationId} Guest response (no DB write)`);
      
      const response = buildItemResponse(
        null,
        productUrl,
        productTitle,
        productImageUrl,
        store,
        pricing,
        shippingFeeUsd,
        settings.exchangeRate
      );
      
      return jsonResponse({
        success: true,
        isGuest: true,
        item: response,
        isVehicle,
        requiresQuote: requiresManualQuote,
      });
    }
    
    // Authenticated: Get or create draft order
    const draftResult = await getOrCreateDraftOrder(db, userId!, correlationId);
    if (draftResult.error || !draftResult.data) {
      return errorResponse("Failed to get/create cart", 500);
    }
    const draft = draftResult.data;
    
    // Check for existing item (merge if found)
    const existingResult = await findExistingCartItem(db, draft.id, productUrl, correlationId);
    let merged = false;
    let itemId: string;
    
    if (existingResult.data) {
      // Merge quantities
      const existingItem = existingResult.data;
      const newQuantity = existingItem.quantity + quantity;
      
      const updateResult = await updateCartItem(db, existingItem.id, {
        quantity: newQuantity,
        base_price_usd: productPrice,
        product_image_url: productImageUrl,
        is_vehicle: isVehicle || existingItem.is_vehicle,
        requires_manual_quote: (isVehicle || existingItem.requires_manual_quote) && !existingItem.vehicle_quote_applied,
        updated_at: new Date().toISOString(),
      }, correlationId);
      
      if (updateResult.error || !updateResult.data) {
        return errorResponse("Failed to update cart item", 500);
      }
      
      itemId = existingItem.id;
      merged = true;
      console.log(`[CART_ADD] ${correlationId} Merged item: ${itemId} qty=${newQuantity}`);
    } else {
      // Insert new item
      const newItem = {
        order_id: draft.id,
        product_url: productUrl,
        title: productTitle,
        product_image_url: productImageUrl,
        store,
        quantity,
        base_price_usd: productPrice,
        shipping_item_type_id: finalShippingTypeId,
        est_weight_kg: estWeightKg,
        is_vehicle: isVehicle,
        requires_manual_quote: requiresManualQuote,
        is_saved_for_later: false,
        price_source: userEdited ? "manual_user" : "auto",
        price_confirmation_status: userEdited ? "pending" : null,
        captured_price: userEdited ? (body.capturedPrice ?? body.captured_price ?? null) : null,
      };
      
      const insertResult = await insertCartItem(db, newItem, correlationId);
      if (insertResult.error || !insertResult.data) {
        return errorResponse("Failed to add item to cart", 500);
      }
      
      itemId = insertResult.data.id;
      console.log(`[CART_ADD] ${correlationId} Inserted item: ${itemId}`);
    }
    
    // Update order totals (fire and forget)
    try {
      // Note: We use the shared cartHelpers for this as it handles vehicle logic
      const adminClient = createAdminClient();
      await sharedUpdateOrderTotals(
        adminClient, 
        draft.id,
        settings.shippingBaseFeeUsd,
        settings.shippingPercent,
        settings.exchangeRate
      );
    } catch (e) {
      console.warn(`[CART_ADD] ${correlationId} Failed to update totals:`, (e as Error).message);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[CART_ADD] ${correlationId} Success in ${duration}ms merged=${merged}`);
    
    // Build response
    const response = buildItemResponse(
      itemId,
      productUrl,
      productTitle,
      productImageUrl,
      store,
      pricing,
      shippingFeeUsd,
      settings.exchangeRate,
      merged
    );
    
    return jsonResponse({
      success: true,
      merged,
      isGuest: false,
      item: response,
      orderId: draft.id,
      isVehicle,
      requiresQuote: requiresManualQuote,
    });
    
  } catch (e: unknown) {
    const duration = Date.now() - startTime;
    console.error(`[CART_ADD] ${correlationId} Error after ${duration}ms:`, (e as Error).message);
    return errorResponse((e as Error).message || "Internal error", 500);
  }
});
