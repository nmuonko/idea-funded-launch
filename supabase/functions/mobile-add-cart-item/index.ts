import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createClient, SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  handleCors, 
  corsHeaders, 
  errorResponse, 
  jsonResponse,
  extractBearerToken,
  createAdminClient,
} from "../_shared/auth.ts";
import {
  determineShippingCategory,
  getShippingTypeIdForCategory,
  VEHICLE_QUOTE_CONFIDENCE_THRESHOLD,
  type ShippingCategoryKey,
} from "../_shared/shippingCategory.ts";
import { getCachedSettings, round2 } from "../_shared/settings-cache.ts";
// CRITICAL: Import shared updateOrderTotals to ensure vehicle handling is consistent
import { updateOrderTotals as sharedUpdateOrderTotals } from "../_shared/cartHelpers.ts";

// Input validation schema
const addCartItemSchema = z.object({
  productUrl: z.string()
    .min(1, "Product URL is required")
    .max(2048, "URL too long")
    .url("Invalid URL format")
    .refine((url) => {
      try {
        const parsed = new URL(url);
        const allowedDomains = [
          'amazon.com', 'www.amazon.com',
          'ebay.com', 'www.ebay.com',
          'walmart.com', 'www.walmart.com',
          'bestbuy.com', 'www.bestbuy.com',
          // Car marketplaces (deprecated - kept for historical compatibility)
          'carvana.com', 'www.carvana.com',
          'cargurus.com', 'www.cargurus.com',
          // NEW: Active car marketplaces
          'tesla.com', 'www.tesla.com',
          'edmunds.com', 'www.edmunds.com',
          // Other retailers
          'target.com', 'www.target.com',
          'homedepot.com', 'www.homedepot.com',
          'shein.com', 'www.shein.com', 'us.shein.com', 'm.shein.com',
          'macys.com', 'www.macys.com', 'm.macys.com',
          // Mercari and Wayfair
          'mercari.com', 'www.mercari.com',
          'wayfair.com', 'www.wayfair.com',
        ];
        return allowedDomains.some(d => parsed.hostname.endsWith(d));
      } catch {
        return false;
      }
    }, "URL must be from a supported retailer (Amazon, eBay, Walmart, BestBuy, Tesla, Edmunds, Target, Home Depot, SHEIN, Macy's, Mercari, Wayfair)"),
  productPrice: z.number()
    .positive("Price must be positive")
    .max(1000000, "Price exceeds maximum"),
  quantity: z.number().int().positive().max(100).optional().default(1),
  shippingItemTypeId: z.string().uuid().optional(),
  productTitle: z.string().max(500).optional(),
  productImageUrl: z.string().url().max(2048).optional(),
  // Explicit user-edited price signals
  priceEdited: z.union([z.boolean(), z.string()]).optional(),
  manual_price: z.union([z.boolean(), z.string()]).optional(),
  price_source: z.string().optional(),
  // Captured price for reference (from scraper)
  capturedPrice: z.number().optional(),
  captured_price: z.number().optional(),
  currency: z.string().optional(),
}).passthrough();

// Pricing helper - single source of truth for price calculations
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

/**
 * CRITICAL: Detect if price was USER edited using ONLY explicit signals
 * NEVER mark PENDING due to scraped price mismatch
 */
function isUserEditedPrice(body: any): boolean {
  // Check explicit boolean flags (handle string "true" too)
  const priceEditedFlag = 
    body?.priceEdited === true ||
    String(body?.priceEdited ?? "").toLowerCase() === "true" ||
    body?.manual_price === true ||
    String(body?.manual_price ?? "").toLowerCase() === "true";
  
  // Check price_source (case-insensitive) - accept both "manual" and "manual_user"
  const priceSource = String(body?.price_source ?? "").toLowerCase();
  const isManualSource = priceSource === "manual_user" || priceSource === "manual";
  
  return priceEditedFlag || isManualSource;
}

// Heavy threshold for manual quote requirement
const HEAVY_THRESHOLD_KG = 9;

/**
 * Optionally verify JWT and get user - returns null user if no valid token
 * This allows guests to use the endpoint for price calculation
 */
async function optionallyGetUser(req: Request): Promise<{ user: User | null; supabase: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization');
  const token = extractBearerToken(authHeader);
  
  // Create admin client for all operations (bypasses RLS)
  const adminClient = createAdminClient();
  
  if (!token) {
    console.log('[mobile-add-cart-item] No auth token provided - guest mode');
    return { user: null, supabase: adminClient };
  }

  try {
    const { data: { user }, error } = await adminClient.auth.getUser(token);
    
    if (error || !user) {
      console.log('[mobile-add-cart-item] Invalid token - guest mode:', error?.message);
      return { user: null, supabase: adminClient };
    }
    
    console.log('[mobile-add-cart-item] User authenticated:', user.id);
    return { user, supabase: adminClient };
  } catch (e: any) {
    console.log('[mobile-add-cart-item] Auth error - guest mode:', e.message);
    return { user: null, supabase: adminClient };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // OPTIONAL AUTH - guests allowed for price calculation
    const { user, supabase } = await optionallyGetUser(req);
    
    const isGuest = user === null;
    console.log('[mobile-add-cart-item] Mode:', isGuest ? 'GUEST' : 'AUTHENTICATED');

    const body = await req.json();

    // Validate input with zod schema
    const parseResult = addCartItemSchema.safeParse(body);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.errors.map(e => e.message).join(', ');
      console.log('[mobile-add-cart-item] Validation error:', errorMessage);
      return errorResponse(errorMessage, 400);
    }

    const { productUrl, productPrice, quantity, shippingItemTypeId, productTitle: inputTitle, productImageUrl: inputImageUrl } = parseResult.data;

    console.log('[mobile-add-cart-item] request:', { productUrl, productPrice, quantity, shippingItemTypeId, isGuest });

    // CRITICAL: Detect if price was USER edited using ONLY explicit signals
    const userEdited = isUserEditedPrice(body);
    const capturedPrice = body.capturedPrice ?? body.captured_price ?? null;
    const currency = body.currency ?? 'USD';
    
    console.log('[PRICE_CONFIRM] userEdited=', userEdited, 
      'priceEdited=', body.priceEdited,
      'manual_price=', body.manual_price,
      'price_source=', body.price_source,
      'productPrice=', productPrice,
      'capturedPrice=', capturedPrice);

    // Load shipping type if provided
    let estWeightKg = 1; // default 1kg
    let itemRequiresManualQuote = false;

    if (shippingItemTypeId) {
      const { data: shippingType, error: typeError } = await supabase
        .from('shipping_item_types')
        .select('est_weight_kg, requires_manual_quote')
        .eq('id', shippingItemTypeId)
        .eq('active', true)
        .single();

      if (typeError || !shippingType) {
        console.error('[mobile-add-cart-item] Invalid shipping type:', typeError);
        return errorResponse('Invalid shipping item type', 400);
      }

      estWeightKg = shippingType.est_weight_kg;
      // FIXED: Only vehicles require manual quote, NOT heavy items
      itemRequiresManualQuote = false; // Will be set later if item is a vehicle
      console.log('[mobile-add-cart-item] Shipping type loaded:', { estWeightKg });
    }

    // Load pricing settings - use cached version for performance
    const settingsStart = Date.now();
    const settings = await getCachedSettings(supabase);
    const settingsTime = Date.now() - settingsStart;
    
    const markupPercent = settings.markupPercent;
    const exchangeRate = settings.exchangeRate;
    const shippingBaseFeeUsd = settings.shippingBaseFeeUsd;
    const shippingPercent = settings.shippingPercent;

    console.log(`[mobile-add-cart-item] Settings loaded in ${settingsTime}ms:`, {
      markupPercent,
      shippingBaseFeeUsd,
      shippingPercent,
      exchangeRate,
    });

    // Calculate pricing using helper
    const pricing = calculateItemPricing(productPrice, quantity, markupPercent, exchangeRate);

    console.log('[mobile-add-cart-item] computed prices:', {
      basePriceUsd: pricing.basePriceUsd,
      quantity: pricing.quantity,
      itemBaseTotalUsd: pricing.itemBaseTotalUsd,
      itemMarginUsd: pricing.itemMarginUsd,
      itemSubtotalUsd: pricing.itemSubtotalUsd,
      itemSubtotalCdf: pricing.itemSubtotalCdf,
      markupPercent,
    });

    // Detect store from URL
    let store = 'OTHER';
    try {
      const urlObj = new URL(productUrl);
      const hostname = urlObj.hostname.toLowerCase();
      const pathname = urlObj.pathname.toLowerCase();
      
      if (hostname.includes('amazon')) store = 'AMAZON';
      else if (hostname.includes('ebay')) store = 'EBAY';
      else if (hostname.includes('walmart')) store = 'WALMART';
      else if (hostname.includes('bestbuy')) store = 'BESTBUY';
      // NEW: Active car marketplaces (preferred)
      else if (hostname.includes('tesla') && pathname.includes('/inventory')) store = 'TESLA_USED';
      else if (hostname.includes('edmunds')) store = 'EDMUNDS';
      // DEPRECATED: Old car marketplaces (log usage for tracking)
      else if (hostname.includes('carvana')) {
        store = 'CARVANA';
        console.warn('[mobile-add-cart-item] DEPRECATED_CAR_SOURCE: carvana used for new item');
      }
      else if (hostname.includes('cargurus')) {
        store = 'CARGURUS';
        console.warn('[mobile-add-cart-item] DEPRECATED_CAR_SOURCE: cargurus used for new item');
      }
      else if (hostname.includes('target')) store = 'OTHER'; // Keep as OTHER - no enum value
      else if (hostname.includes('homedepot')) store = 'OTHER';
      else if (hostname.includes('shein')) store = 'OTHER';
      else if (hostname.includes('macys')) store = 'OTHER';
      else if (hostname.includes('mercari')) store = 'MERCARI';
      else if (hostname.includes('wayfair')) store = 'WAYFAIR';
    } catch (e) {
      console.error('[mobile-add-cart-item] Invalid URL format:', e);
    }

    let productTitle = inputTitle ?? null;
    let productImageUrl = inputImageUrl ?? null;

    // If image or title not provided, try to scrape from product URL (with timeout)
    if (!productImageUrl || !productTitle) {
      console.log('[mobile-add-cart-item] Scraping product info for:', productUrl);
      const scrapeStart = Date.now();
      
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        
        // Create abort controller with 4s timeout for scraping
        const scrapeController = new AbortController();
        const scrapeTimeout = setTimeout(() => {
          console.warn('[mobile-add-cart-item] Scrape timeout reached (4s)');
          scrapeController.abort();
        }, 4000);
        
        try {
          const scrapeResponse = await fetch(`${supabaseUrl}/functions/v1/get-product-info`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ url: productUrl }),
            signal: scrapeController.signal,
          });
          
          clearTimeout(scrapeTimeout);
          
          if (scrapeResponse.ok) {
            const scrapeData = await scrapeResponse.json();
            const scrapeDuration = Date.now() - scrapeStart;
            console.log(`[mobile-add-cart-item] Scraped product data (${scrapeDuration}ms):`, JSON.stringify(scrapeData).substring(0, 200));
            
            // get-product-info returns imageUrl (camelCase), not image_url
            if (!productImageUrl && scrapeData.imageUrl) {
              productImageUrl = scrapeData.imageUrl;
              console.log('[mobile-add-cart-item] Got image URL from scrape');
            }
            if (!productTitle && scrapeData.productTitle) {
              productTitle = scrapeData.productTitle;
            }
          } else {
            console.warn(`[mobile-add-cart-item] Scrape response not ok: ${scrapeResponse.status} (${Date.now() - scrapeStart}ms)`);
          }
        } finally {
          clearTimeout(scrapeTimeout);
        }
      } catch (scrapeError: any) {
        const scrapeDuration = Date.now() - scrapeStart;
        if (scrapeError.name === 'AbortError') {
          console.warn(`[mobile-add-cart-item] Scrape aborted after ${scrapeDuration}ms - continuing without image`);
        } else {
          console.error(`[mobile-add-cart-item] Failed to scrape product info (${scrapeDuration}ms):`, scrapeError.message);
        }
        // Continue without image - it's not critical
      }
    }

    // AUTO-DETECT SHIPPING CATEGORY - ALWAYS applied, no manual selection needed
    let finalShippingTypeId = shippingItemTypeId || null;
    let autoDetectedCategory: ShippingCategoryKey | null = null;
    let isVehicle = false;
    let vehicleRequiresQuote = false;
    let isShippingCategoryEstimated = false;
    
    // Always detect category from title/url/store
    const detection = determineShippingCategory({
      title: productTitle || '',
      url: productUrl,
      store: store,
      existingCategory: null,
    });

    console.log('[mobile-add-cart-item] Category detection result:', {
      category: detection.category,
      confidence: detection.confidence,
      requiresQuote: detection.requiresQuote,
      isEstimated: detection.isEstimated,
      matchedKeywords: detection.matchedKeywords.slice(0, 5),
    });

    autoDetectedCategory = detection.category;
    isShippingCategoryEstimated = detection.isEstimated;

    // Check if this is a vehicle requiring a quote
    if (detection.category === 'vehicle' && detection.requiresQuote) {
      isVehicle = true;
      vehicleRequiresQuote = true;
      itemRequiresManualQuote = true; // Vehicles always require manual quote
      // Don't set a shipping type for vehicles - they need custom quotes
      finalShippingTypeId = null;
      isShippingCategoryEstimated = false; // Vehicles don't use estimated flag
      
      console.log('[mobile-add-cart-item] Vehicle detected - requires manual quote:', {
        category: detection.category,
        confidence: detection.confidence,
      });
    }
    // For non-vehicle categories, always apply the detected category
    else if (detection.category && detection.category !== 'vehicle') {
      const shippingType = await getShippingTypeIdForCategory(supabase, detection.category);
      
      if (shippingType) {
        finalShippingTypeId = shippingType.id;
        estWeightKg = shippingType.estWeightKg;
        // FIXED: Only vehicles require manual quote, NOT heavy items or shipping type flags
        itemRequiresManualQuote = false;
        
        console.log('[mobile-add-cart-item] Applied category:', {
          category: detection.category,
          shippingTypeId: finalShippingTypeId,
          estWeightKg,
          isEstimated: detection.isEstimated,
        });
      }
    }

    // ========== GUEST MODE: Return price data only, no DB writes ==========
    if (isGuest) {
      console.log('[mobile-add-cart-item] Guest mode - returning price data without DB write');
      
      // Calculate estimated shipping for guest display
      const estimatedShippingFee = itemRequiresManualQuote ? 0 : round2(shippingBaseFeeUsd + (pricing.itemBaseTotalUsd * shippingPercent));
      const estimatedTotalUsd = round2(pricing.itemSubtotalUsd + estimatedShippingFee);
      const estimatedTotalCdf = round2(estimatedTotalUsd * exchangeRate);
      
      return jsonResponse({
        success: true,
        isGuest: true,
        item: {
          id: null, // No DB record for guests
          productUrl,
          productTitle,
          productImageUrl,
          image_url: productImageUrl,
          store,
          basePriceUsd: pricing.basePriceUsd,
          quantity: pricing.quantity,
          unitPriceUsd: pricing.basePriceUsd,
          itemBaseTotalUsd: pricing.itemBaseTotalUsd,
          itemMarginUsd: pricing.itemMarginUsd,
          itemSubtotalUsd: pricing.itemSubtotalUsd,
          itemSubtotalCdf: pricing.itemSubtotalCdf,
          estWeightKg,
          requiresManualQuote: itemRequiresManualQuote,
          shippingItemTypeId: finalShippingTypeId,
          shippingCategory: autoDetectedCategory,
          isShippingCategoryEstimated,
          isVehicle,
          isQuoteRequired: isVehicle && vehicleRequiresQuote,
          quoteStatus: null,
          // Estimated shipping for guest display
          estimatedShippingFee,
          estimatedTotalUsd,
          estimatedTotalCdf,
        },
        summary: {
          itemTotalUsd: pricing.itemBaseTotalUsd,
          serviceFeeUsd: pricing.itemMarginUsd,
          shippingFeeUsd: estimatedShippingFee,
          totalUsd: estimatedTotalUsd,
          totalCdf: estimatedTotalCdf,
          exchangeRate,
          requiresManualQuote: itemRequiresManualQuote,
        },
        message: 'Price calculated. Login to save to cart.',
      });
    }

    // ========== AUTHENTICATED MODE: Full cart functionality ==========
    
    // CRITICAL: Ensure user has a profile (orders.user_id references profiles.user_id)
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existingProfile) {
      console.log('[mobile-add-cart-item] Creating profile for user:', user.id);
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({ 
          user_id: user.id, 
          full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        });

      if (profileError) {
        console.error('[mobile-add-cart-item] Failed to create profile:', profileError);
        return errorResponse(`Failed to create user profile: ${profileError.message}`, 500);
      }
      console.log('[mobile-add-cart-item] Profile created successfully');
    }

    // SHARED CART RESOLUTION: Same logic as mobile-get-cart
    // Returns the single DRAFT order ID for this user, creating if needed
    const resolveCartId = async (userId: string): Promise<string> => {
      console.log('[ADD_CART_DEBUG] resolveCartId called for userId:', userId);
      
      // Step 1: Find existing DRAFT orders for this user
      const { data: drafts, error: draftsError } = await supabase
        .from('orders')
        .select('id, created_at')
        .eq('user_id', userId)
        .eq('status', 'DRAFT')
        .order('created_at', { ascending: false });

      if (draftsError) {
        console.error('[ADD_CART_DEBUG] Failed to query drafts:', draftsError);
        throw new Error('Failed to access cart');
      }
      
      console.log('[ADD_CART_DEBUG] Found drafts:', drafts?.length || 0);

      // Step 2: If no drafts, create one
      if (!drafts || drafts.length === 0) {
        console.log('[ADD_CART_DEBUG] Creating new DRAFT order for user:', userId);
        const { data: newOrder, error: createError } = await supabase
          .from('orders')
          .insert({ 
            user_id: userId, 
            status: 'DRAFT',
            exchange_rate_used: exchangeRate,
          })
          .select('id')
          .single();
        
        if (createError || !newOrder) {
          console.error('[ADD_CART_DEBUG] Failed to create order:', createError);
          throw new Error('Failed to create cart');
        }
        
        console.log('[ADD_CART_DEBUG] Created new order:', newOrder.id);
        return newOrder.id;
      }

      // Step 3: If multiple drafts exist, merge them
      if (drafts.length > 1) {
        const primaryId = drafts[0].id;
        const secondaryIds = drafts.slice(1).map(d => d.id);
        console.log('[ADD_CART_DEBUG] Merging', secondaryIds.length, 'drafts into:', primaryId);
        
        for (const old of drafts.slice(1)) {
          await supabase.from('order_items').update({ order_id: primaryId }).eq('order_id', old.id);
          await supabase.from('orders').delete().eq('id', old.id);
        }
        
        return primaryId;
      }

      console.log('[ADD_CART_DEBUG] Using existing draft:', drafts[0].id);
      return drafts[0].id;
    };

    const orderId = await resolveCartId(user.id);
    console.log('[CART_DEBUG]', JSON.stringify({ fn: 'add-cart-item', userId: user.id, cartId: orderId, action: 'resolved' }));

    // Check for duplicate items (same product_url in this order)
    const { data: existingItem } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId)
      .eq('product_url', productUrl)
      .single();

    if (existingItem) {
      // Merge by updating quantity and recalculating
      const newQuantity = existingItem.quantity + quantity;
      const mergedPricing = calculateItemPricing(
        existingItem.base_price_usd,
        newQuantity,
        markupPercent,
        exchangeRate
      );

      const { data: updatedItem, error: updateError } = await supabase
        .from('order_items')
        .update({ 
          quantity: newQuantity,
          subtotal_usd: mergedPricing.itemBaseTotalUsd,
          markup_fee_usd: mergedPricing.itemMarginUsd,
          total_price_usd: mergedPricing.itemSubtotalUsd,
          total_price_cdf: mergedPricing.itemSubtotalCdf,
          // Update shipping fields if provided or auto-detected
          ...(finalShippingTypeId && {
            shipping_item_type_id: finalShippingTypeId,
            est_weight_kg: estWeightKg,
            requires_manual_quote: itemRequiresManualQuote,
          }),
        })
        .eq('id', existingItem.id)
        .select()
        .single();

      if (updateError) {
        console.error('[mobile-add-cart-item] Failed to merge item:', updateError);
        return errorResponse('Failed to merge cart item', 500);
      }

      console.log('[mobile-add-cart-item] Merged duplicate item, new quantity:', newQuantity);

      // UPDATE ORDER TOTALS after merge - use settings values
      const summary = await sharedUpdateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);

      const mergedImageUrl = updatedItem.product_image_url || null;
      
      return jsonResponse({
        success: true,
        merged: true,
        item: {
          id: updatedItem.id,
          productUrl: updatedItem.product_url,
          productTitle: updatedItem.title || null,
          productImageUrl: mergedImageUrl,
          image_url: mergedImageUrl, // Alias for mobile app compatibility
          store: updatedItem.store,
          basePriceUsd: updatedItem.base_price_usd,
          quantity: updatedItem.quantity,
          unitPriceUsd: updatedItem.unit_price_usd || updatedItem.base_price_usd,
          itemBaseTotalUsd: updatedItem.subtotal_usd,
          itemMarginUsd: updatedItem.markup_fee_usd,
          itemSubtotalUsd: updatedItem.total_price_usd,
          itemSubtotalCdf: updatedItem.total_price_cdf,
          estWeightKg: updatedItem.est_weight_kg,
          requiresManualQuote: updatedItem.requires_manual_quote || false,
          shippingItemTypeId: updatedItem.shipping_item_type_id || null,
          // New shipping category fields
          shippingCategory: autoDetectedCategory,
          isShippingCategoryEstimated: isShippingCategoryEstimated,
          isQuoteRequired: isVehicle && vehicleRequiresQuote,
        },
        summary,
      });
    }

    // Insert new item into order_items
    // CRITICAL: Set price_confirmation_status based on userEdited flag ONLY
    const priceConfirmationStatus = userEdited ? 'PENDING' : 'APPROVED';
    const priceSource = userEdited ? 'manual_user' : 'scraped';
    
    const { data, error: itemError } = await supabase
      .from('order_items')
      .insert({
        order_id: orderId,
        product_url: productUrl,
        title: productTitle,
        product_image_url: productImageUrl,
        store,
        base_price_usd: pricing.basePriceUsd,
        unit_price_usd: pricing.basePriceUsd,
        quantity: pricing.quantity,
        subtotal_usd: pricing.itemBaseTotalUsd,
        markup_fee_usd: pricing.itemMarginUsd,
        shipping_fee_usd: 0,
        total_price_usd: pricing.itemSubtotalUsd,
        total_price_cdf: pricing.itemSubtotalCdf,
        // Shipping type fields - use auto-detected or provided
        shipping_item_type_id: finalShippingTypeId,
        est_weight_kg: estWeightKg,
        requires_manual_quote: itemRequiresManualQuote,
        is_vehicle: isVehicle,
        // CRITICAL: Price confirmation fields
        price_confirmation_status: priceConfirmationStatus,
        price_source: priceSource,
        captured_price: capturedPrice,
      })
      .select()
      .single();

    if (itemError) {
      console.error('[mobile-add-cart-item] cart_items insert error:', itemError);
      return errorResponse('Failed to add item to cart.', 500);
    }

    // CRITICAL: Read-back validation - confirm the item is readable
    const { data: readBackItem, error: readBackError } = await supabase
      .from('order_items')
      .select('id, order_id')
      .eq('id', data.id)
      .eq('order_id', orderId)
      .single();

    if (readBackError || !readBackItem) {
      console.error('[ADD_CART_DEBUG] READ-BACK FAILED! Insert succeeded but item not readable:', {
        insertedId: data.id,
        orderId,
        userId: user.id,
        readBackError: readBackError?.message,
      });
      return errorResponse('Insert reported success but row not readable; likely RLS or cart mismatch', 500);
    }

    console.log('[ADD_CART_DEBUG] Read-back confirmed:', { itemId: readBackItem.id, orderId: readBackItem.order_id });

    // CRITICAL: If user edited price, create price_confirmations record AND admin notification
    if (userEdited) {
      console.log('[mobile-add-cart-item] User edited price - creating price_confirmations record');
      
      // Create price_confirmations record (this is what admin panel queries)
      const { data: priceConfirmation, error: pcError } = await supabase
        .from('price_confirmations')
        .insert({
          user_id: user.id,
          cart_item_id: data.id,
          product_url: productUrl,
          store: store.toUpperCase(),
          proposed_price: productPrice,
          proposed_currency: currency.toUpperCase(),
          extracted_price: capturedPrice,
          extracted_currency: capturedPrice ? currency.toUpperCase() : null,
          extraction_source: capturedPrice ? 'structured' : 'manual',
          extraction_confidence: capturedPrice ? 0.8 : null,
          status: 'PENDING',
        })
        .select('id')
        .single();
      
      if (pcError) {
        console.error('[mobile-add-cart-item] Failed to create price_confirmations:', pcError);
        // Don't fail - just log
      } else {
        console.log('[mobile-add-cart-item] Created price_confirmations:', priceConfirmation.id);
        
        // Update order_item with the price_confirmation_id
        await supabase
          .from('order_items')
          .update({ price_confirmation_id: priceConfirmation.id })
          .eq('id', data.id);
      }
      
      // Create admin notification for review
      const { error: notifError } = await supabase
        .from('admin_notifications')
        .insert({
          type: 'PRICE_REVIEW',
          title: 'Price confirmation needed',
          body: `User edited price for ${productTitle || store} item. Review required.`,
          payload: {
            cart_item_id: data.id,
            user_id: user.id,
            store,
            product_url: productUrl,
            captured_price: capturedPrice,
            user_price: productPrice,
            currency,
            price_confirmation_id: priceConfirmation?.id,
          },
        });
      
      if (notifError) {
        console.error('[mobile-add-cart-item] Failed to create admin notification:', notifError);
        // Don't fail the operation, just log
      } else {
        console.log('[mobile-add-cart-item] Admin notification created for price review');
      }
    }

    // If this is a vehicle, create a quote request
    let quoteStatus: string | null = null;
    if (isVehicle && vehicleRequiresQuote) {
      const { error: quoteError } = await supabase
        .from('quote_requests')
        .insert({
          user_id: user.id,
          order_item_id: data.id,
          title: productTitle,
          product_url: productUrl,
          store_name: store,
          status: 'PENDING',
        });

      if (quoteError) {
        console.error('[mobile-add-cart-item] Failed to create quote request:', quoteError);
        // Don't fail the whole operation, just log the error
      } else {
        quoteStatus = 'PENDING';
        console.log('[mobile-add-cart-item] Created quote request for vehicle:', data.id);
      }
    }

    // UPDATE ORDER TOTALS after adding new item - use settings values
    const summary = await sharedUpdateOrderTotals(supabase, orderId, shippingBaseFeeUsd, shippingPercent, exchangeRate);

    // Get item count for the response
    const { count: itemCount } = await supabase
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId);

    const newImageUrl = data.product_image_url || null;
    
    console.log('[CART_DEBUG]', JSON.stringify({ fn: 'add-cart-item', userId: user.id, cartId: orderId, action: 'insert_success', insertedItemId: data.id, itemCount: itemCount, priceConfirmationStatus, pendingCount: priceConfirmationStatus === 'PENDING' ? 1 : 0 }));
    
    return jsonResponse({
      success: true,
      cart_id: orderId,  // Include cart_id in response for verification
      item_count: itemCount || 1,
      item: {
        id: data.id,
        productUrl: data.product_url,
        productTitle: data.title || null,
        productImageUrl: newImageUrl,
        image_url: newImageUrl, // Alias for mobile app compatibility
        store: data.store,
        basePriceUsd: data.base_price_usd,
        quantity: data.quantity,
        unitPriceUsd: data.unit_price_usd || data.base_price_usd,
        itemBaseTotalUsd: data.subtotal_usd,
        itemMarginUsd: data.markup_fee_usd,
        itemSubtotalUsd: data.total_price_usd,
        itemSubtotalCdf: data.total_price_cdf,
        estWeightKg: data.est_weight_kg,
        requiresManualQuote: data.requires_manual_quote || false,
        shippingItemTypeId: data.shipping_item_type_id || null,
        // New shipping category fields
        shippingCategory: autoDetectedCategory,
        isShippingCategoryEstimated: isShippingCategoryEstimated,
        // Vehicle-specific fields
        isVehicle: data.is_vehicle || false,
        isQuoteRequired: isVehicle && vehicleRequiresQuote,
        quoteStatus: quoteStatus,
        // Price confirmation status
        priceConfirmationStatus: data.price_confirmation_status,
      },
      summary,
    });

  } catch (error: any) {
    console.error('[mobile-add-cart-item] Error:', error.message);
    
    // Never return SESSION_EXPIRED for this endpoint - it's guest-friendly
    return errorResponse(error.message || 'An error occurred', 500);
  }
});
