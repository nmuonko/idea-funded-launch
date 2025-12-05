import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  corsHeaders, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

// Round to 2 decimals helper
const round2 = (n: number) => Math.round(n * 100) / 100;

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

// Shipping constants
const BASE_FEE_USD = 20;
const PERCENT_FEE = 0.10;
const EXTRA_PER_KG_USD = 8;
const HEAVY_THRESHOLD_KG = 9;

// Calculate shipping for a single item based on weight
function calculateItemShipping(subtotalUsd: number, estWeightKg: number): number {
  const extraWeight = Math.max(0, estWeightKg - 1);
  const basePart = BASE_FEE_USD + (subtotalUsd * PERCENT_FEE);
  const extraPart = extraWeight * EXTRA_PER_KG_USD;
  return round2(basePart + extraPart);
}

// Calculate and persist order totals from items with new shipping logic
async function updateOrderTotals(
  supabase: any,
  orderId: string,
  exchangeRate: number
) {
  // Get all items for this order with shipping type info
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('subtotal_usd, markup_fee_usd, total_price_usd, quantity, est_weight_kg, requires_manual_quote')
    .eq('order_id', orderId);

  if (itemsError) {
    console.error('[updateOrderTotals] Failed to fetch items:', itemsError);
    return null;
  }

  // Calculate order totals from items
  let itemTotalUsd = 0;
  let serviceFeeUsd = 0;
  let itemsWithMarkupUsd = 0;
  let shippingFeeUsd = 0;
  let requiresManualQuote = false;

  (items || []).forEach((item: any) => {
    const subtotal = Number(item.subtotal_usd || 0);
    const markup = Number(item.markup_fee_usd || 0);
    const total = Number(item.total_price_usd || 0);
    const estWeight = Number(item.est_weight_kg || 1);
    const itemRequiresQuote = item.requires_manual_quote || estWeight > HEAVY_THRESHOLD_KG;

    itemTotalUsd += subtotal;
    serviceFeeUsd += markup;
    itemsWithMarkupUsd += total;

    if (itemRequiresQuote) {
      requiresManualQuote = true;
    } else {
      // Only calculate shipping for items that don't require manual quote
      shippingFeeUsd += calculateItemShipping(subtotal, estWeight);
    }
  });

  // If any item requires manual quote, set shipping to 0
  if (requiresManualQuote) {
    shippingFeeUsd = 0;
  }
  
  // Grand totals
  const totalUsd = round2(itemsWithMarkupUsd + shippingFeeUsd);
  const totalCdf = round2(totalUsd * exchangeRate);

  console.log('[updateOrderTotals] Calculated totals:', {
    orderId,
    itemTotalUsd: round2(itemTotalUsd),
    serviceFeeUsd: round2(serviceFeeUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    totalUsd,
    totalCdf,
    requiresManualQuote,
    itemCount: items?.length || 0,
  });

  // Persist to orders table
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
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-add-cart-item] User authenticated:', user.id);

    const body = await req.json();

    // Read and validate body
    const productUrl = body.productUrl;
    const productPrice = Number(body.productPrice);
    const quantity = Number.isFinite(body.quantity) && body.quantity > 0 ? Math.floor(body.quantity) : 1;
    const shippingItemTypeId = body.shippingItemTypeId; // NEW: shipping type ID

    if (!productUrl || typeof productUrl !== 'string') {
      return errorResponse('productUrl is required', 400);
    }

    if (!Number.isFinite(productPrice) || productPrice <= 0) {
      return errorResponse('productPrice must be a positive number', 400);
    }

    console.log('[mobile-add-cart-item] request:', { productUrl, productPrice, quantity, shippingItemTypeId });

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
      itemRequiresManualQuote = shippingType.requires_manual_quote || estWeightKg > HEAVY_THRESHOLD_KG;
      console.log('[mobile-add-cart-item] Shipping type loaded:', { estWeightKg, itemRequiresManualQuote });
    }

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

    // Load pricing settings
    const { data: settings } = await supabase.from('settings').select('*').maybeSingle();
    
    if (!settings) {
      console.error('[mobile-add-cart-item] No settings found in database');
      return errorResponse('Pricing settings not configured', 500);
    }

    const markupPercent = settings.markup_percent ?? settings.global_markup_percent ?? 15;
    const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 2800;

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
      if (hostname.includes('amazon')) store = 'AMAZON';
      else if (hostname.includes('ebay')) store = 'EBAY';
      else if (hostname.includes('walmart')) store = 'WALMART';
      else if (hostname.includes('bestbuy')) store = 'BESTBUY';
      else if (hostname.includes('carvana')) store = 'CARVANA';
      else if (hostname.includes('cargurus')) store = 'CARGURUS';
    } catch (e) {
      console.error('[mobile-add-cart-item] Invalid URL format:', e);
    }

    let productTitle = body.productTitle ?? null;
    let productImageUrl = body.productImageUrl ?? null;

    // If image or title not provided, try to scrape from product URL
    if (!productImageUrl || !productTitle) {
      console.log('[mobile-add-cart-item] Scraping product info for:', productUrl);
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        
        const scrapeResponse = await fetch(`${supabaseUrl}/functions/v1/get-product-info`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ url: productUrl }),
        });
        
        if (scrapeResponse.ok) {
          const scrapeData = await scrapeResponse.json();
          console.log('[mobile-add-cart-item] Scraped product data:', JSON.stringify(scrapeData));
          
          // get-product-info returns imageUrl (camelCase), not image_url
          if (!productImageUrl && scrapeData.imageUrl) {
            productImageUrl = scrapeData.imageUrl;
            console.log('[mobile-add-cart-item] Got image URL from scrape:', productImageUrl);
          }
          if (!productTitle && scrapeData.title) {
            productTitle = scrapeData.title;
          }
        } else {
          console.error('[mobile-add-cart-item] Scrape response not ok:', scrapeResponse.status);
        }
      } catch (scrapeError) {
        console.error('[mobile-add-cart-item] Failed to scrape product info:', scrapeError);
        // Continue without image - it's not critical
      }
    }

    // Get or create DRAFT order
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'DRAFT')
      .maybeSingle();

    let orderId = existingOrder?.id;

    if (!orderId) {
      console.log('[mobile-add-cart-item] Creating new DRAFT order for user:', user.id);
      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({ user_id: user.id, status: 'DRAFT' })
        .select('id')
        .single();

      if (orderError) {
        console.error('[mobile-add-cart-item] Failed to create order:', orderError);
        return errorResponse(`Failed to create cart: ${orderError.message}`, 500);
      }

      orderId = newOrder.id;
      console.log('[mobile-add-cart-item] Created new order:', orderId);
    }

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
          // Update shipping fields if provided
          ...(shippingItemTypeId && {
            shipping_item_type_id: shippingItemTypeId,
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

      // UPDATE ORDER TOTALS after merge
      const summary = await updateOrderTotals(supabase, orderId, exchangeRate);

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
        },
        summary,
      });
    }

    // Insert new item into order_items
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
        // Shipping type fields
        shipping_item_type_id: shippingItemTypeId || null,
        est_weight_kg: estWeightKg,
        requires_manual_quote: itemRequiresManualQuote,
      })
      .select()
      .single();

    if (itemError) {
      console.error('[mobile-add-cart-item] cart_items insert error:', itemError);
      return errorResponse('Failed to add item to cart.', 500);
    }

    // UPDATE ORDER TOTALS after adding new item
    const summary = await updateOrderTotals(supabase, orderId, exchangeRate);

    const newImageUrl = data.product_image_url || null;
    
    return jsonResponse({
      success: true,
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
      },
      summary,
    });

  } catch (error: any) {
    console.error('[mobile-add-cart-item] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});
