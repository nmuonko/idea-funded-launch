// Shared cart helpers - single source of truth for cart calculations
// Used by: mobile-add-cart-item, mobile-update-cart-item, mobile-delete-cart-item, cart-sync-from-client

import { getCachedSettings, round2 } from "./settings-cache.ts";

// NOTE: HEAVY_THRESHOLD_KG removed - heavy items no longer require manual quote
// Only vehicle items (is_vehicle=true) require shipping quotes

// Calculate pricing for an item
// For vehicles, pass vehicleMarkupPercent instead of general markupPercent
export function calculateItemPricing(
  basePriceUsd: number,
  quantity: number,
  markupPercent: number,
  exchangeRate: number,
  isVehicle: boolean = false,
  vehicleMarkupPercent?: number
) {
  // Use vehicle markup for vehicles, otherwise use general markup
  const effectiveMarkup = (isVehicle && vehicleMarkupPercent !== undefined) 
    ? vehicleMarkupPercent 
    : markupPercent;
  
  const itemBaseTotalUsd = round2(basePriceUsd * quantity);
  const itemMarginUsd = round2(itemBaseTotalUsd * (effectiveMarkup / 100));
  const itemSubtotalUsd = round2(itemBaseTotalUsd + itemMarginUsd);
  const itemSubtotalCdf = round2(itemSubtotalUsd * exchangeRate);

  return {
    basePriceUsd: round2(basePriceUsd),
    quantity,
    itemBaseTotalUsd,
    itemMarginUsd,
    itemSubtotalUsd,
    itemSubtotalCdf,
    markupPercentUsed: effectiveMarkup,  // Return which markup was used
  };
}

// Dynamic shipping calculation: base + (percentage × items subtotal)
// SAFEGUARD: Normalizes shippingPercent regardless of storage format
// If shippingPercent > 1, it's stored as percent (10) so divide by 100
// Otherwise treat as decimal (0.10)
export function calculateShipping(
  itemsSubtotal: number, 
  shippingBaseFee: number, 
  shippingPercent: number
): number {
  const normalizedPercent = shippingPercent > 1 ? shippingPercent / 100 : shippingPercent;
  return round2(shippingBaseFee + (itemsSubtotal * normalizedPercent));
}

// Detect store from URL
export function detectStore(productUrl: string): string {
  try {
    const urlObj = new URL(productUrl);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();
    
    if (hostname.includes('amazon')) return 'AMAZON';
    if (hostname.includes('ebay')) return 'EBAY';
    if (hostname.includes('walmart')) return 'WALMART';
    if (hostname.includes('bestbuy')) return 'BESTBUY';
    // Active car stores
    if (hostname.includes('tesla') && pathname.includes('/inventory')) return 'TESLA_USED';
    if (hostname.includes('edmunds')) return 'EDMUNDS';
    if (hostname.includes('carvana')) return 'CARVANA';
    if (hostname.includes('cargurus')) return 'CARGURUS';
    return 'OTHER';
  } catch {
    return 'OTHER';
  }
}

// Active car stores
export const ACTIVE_CAR_STORES_ENUM = ['TESLA_USED', 'EDMUNDS', 'CARVANA', 'CARGURUS'];

// Deprecated car stores (none currently)
export const DEPRECATED_CAR_STORES_ENUM: string[] = [];

// All car stores (for vehicle detection)
export const ALL_CAR_STORES_ENUM = [...ACTIVE_CAR_STORES_ENUM, ...DEPRECATED_CAR_STORES_ENUM];

// Check if store is a car marketplace
export function isCarStoreEnum(store: string): boolean {
  return ALL_CAR_STORES_ENUM.includes(store.toUpperCase());
}

/**
 * Extract Amazon ASIN from any Amazon URL format
 * Handles /dp/ASIN, /gp/product/ASIN, /gp/aw/d/ASIN, etc.
 */
export function extractAmazonAsin(url: string): string | null {
  const match = url.match(/(?:\/dp\/|\/gp\/(?:product|aw\/d)\/|\/product\/)([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Canonicalize a product URL for storage.
 * Amazon: strips tracking params, rebuilds as clean /dp/ASIN link
 * SHEIN: strips tracking params
 * Others: returns as-is
 */
export function canonicalizeProductUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    // Amazon: extract ASIN and build clean canonical URL
    if (host.includes('amazon.com') || host.includes('amazon.co') || host.includes('amzn.')) {
      const asin = extractAmazonAsin(url);
      if (asin) return `https://www.amazon.com/dp/${asin}`;
    }

    // SHEIN: strip tracking params but keep path
    if (host.includes('shein.com')) {
      return `${u.origin}${u.pathname}`;
    }

    // eBay: strip tracking params but keep /itm/ path
    if (host.includes('ebay.com')) {
      return `${u.origin}${u.pathname}`;
    }

    return url;
  } catch {
    return url;
  }
}

/**
 * Normalize URL for duplicate detection
 * Removes query params, trailing slashes, and normalizes host
 * CRITICAL: This ensures Tesla URLs with ?PaymentType=lease match base URLs
 */
export function normalizeProductUrl(url: string): string {
  try {
    const u = new URL(url);
    // Force lowercase host, remove www prefix
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    // Lowercase path, remove trailing slashes
    let path = u.pathname.toLowerCase().replace(/\/+$/, '');
    // Keep essential path but strip query params entirely
    return `https://${host}${path}`;
  } catch {
    // Fallback: just lowercase and trim
    return url.toLowerCase().trim();
  }
}

/**
 * Check if two URLs refer to the same product (ignoring query params)
 */
export function isSameProductUrl(url1: string, url2: string): boolean {
  return normalizeProductUrl(url1) === normalizeProductUrl(url2);
}

// Check if store is a car marketplace (duplicate removed below)
// (isCarStoreEnum moved above with normalizeProductUrl)

/**
 * Detect if URL is a Tesla inventory/product page
 * Ignores query params (e.g., ?PaymentType=lease)
 */
export function isTeslaInventoryUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.toLowerCase();
    
    if (host !== 'tesla.com') return false;
    
    // Match inventory pages and model pages
    return (
      path.startsWith('/inventory/') ||
      path.startsWith('/inventory') ||
      path.startsWith('/model3') ||
      path.startsWith('/modely') ||
      path.startsWith('/models') ||
      path.startsWith('/modelx') ||
      path.startsWith('/cybertruck')
    );
  } catch {
    return false;
  }
}

/**
 * Check if a product URL or store indicates a vehicle requiring manual quote
 */
export function isVehicleItem(productUrl: string, store: string): boolean {
  const upperStore = store?.toUpperCase() || '';
  
  // Check if store is a known car marketplace
  if (ALL_CAR_STORES_ENUM.includes(upperStore)) {
    return true;
  }
  
  // Fallback: check Tesla URL patterns directly
  if (isTeslaInventoryUrl(productUrl)) {
    return true;
  }
  
  return false;
}

// Check if car store is deprecated for new items
export function isDeprecatedCarStoreEnum(store: string): boolean {
  return DEPRECATED_CAR_STORES_ENUM.includes(store.toUpperCase());
}

export interface OrderTotals {
  itemTotalUsd: number;
  serviceFeeUsd: number;
  shippingFeeUsd: number;
  totalUsd: number;
  totalCdf: number;
  exchangeRate: number;
  requiresManualQuote: boolean;
  activeItemCount: number;
}

/**
 * Get or create a SINGLE DRAFT order for a user.
 * If multiple DRAFT orders exist, merges items into the most recent one.
 * 
 * @returns { cartId, created } where cartId is the single DRAFT order ID
 */
export async function getOrCreateSingleDraftOrder(
  supabase: any,
  userId: string,
  exchangeRate: number
): Promise<{ cartId: string; created: boolean }> {
  // Query ALL draft orders for this user, ordered by created_at DESC
  const { data: drafts, error: draftsError } = await supabase
    .from('orders')
    .select('id, created_at')
    .eq('user_id', userId)
    .eq('status', 'DRAFT')
    .order('created_at', { ascending: false });

  if (draftsError) {
    console.error('[getOrCreateSingleDraftOrder] Error querying drafts:', draftsError);
    throw new Error('Failed to access cart');
  }

  // No drafts - create new one
  if (!drafts || drafts.length === 0) {
    console.log('[getOrCreateSingleDraftOrder] Creating new DRAFT order for user:', userId);
    const { data: newOrder, error: createError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
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
      console.error('[getOrCreateSingleDraftOrder] Failed to create DRAFT order:', createError);
      throw new Error('Failed to create cart');
    }

    return { cartId: newOrder.id, created: true };
  }

  // Single draft - return it
  if (drafts.length === 1) {
    console.log('[getOrCreateSingleDraftOrder] Found single DRAFT order:', drafts[0].id);
    return { cartId: drafts[0].id, created: false };
  }

  // MULTIPLE DRAFTS - merge into most recent (first in list)
  const primaryCartId = drafts[0].id;
  const otherCartIds = drafts.slice(1).map((d: any) => d.id);
  
  console.log('[getOrCreateSingleDraftOrder] Merging multiple DRAFT orders:', {
    primary: primaryCartId,
    toMerge: otherCartIds,
  });

  // Move items from old carts to primary cart
  for (const oldCartId of otherCartIds) {
    const { error: moveError } = await supabase
      .from('order_items')
      .update({ order_id: primaryCartId })
      .eq('order_id', oldCartId);

    if (moveError) {
      console.error('[getOrCreateSingleDraftOrder] Error moving items from cart:', oldCartId, moveError);
    }

    // Delete the empty old cart
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('id', oldCartId);

    if (deleteError) {
      console.error('[getOrCreateSingleDraftOrder] Error deleting old cart:', oldCartId, deleteError);
    }
  }

  console.log('[getOrCreateSingleDraftOrder] Merged', otherCartIds.length, 'carts into:', primaryCartId);
  return { cartId: primaryCartId, created: false };
}

/**
 * Calculate and persist order totals from ACTIVE items only (excluding saved-for-later)
 * This is the SINGLE SOURCE OF TRUTH for order total calculations.
 * 
 * CRITICAL: This function NEVER deletes cart data on errors - it only updates totals or returns null.
 * 
 * Vehicle items with applied quotes use STORED shipping_fee_usd values.
 * Regular items have shipping calculated dynamically.
 * 
 * TOTALS BREAKDOWN:
 * - itemTotalUsd: Sum of base prices (regularItemTotalUsd + vehicleBasePriceTotal)
 * - serviceFeeUsd: Sum of margins (regularServiceFeeUsd + vehicleMarginTotal)
 * - shippingFeeUsd: Sum of shipping (regularShippingFeeUsd + vehicleShippingTotal)
 * - totalUsd: Grand total (items + markup + shipping)
 */
export async function updateOrderTotals(
  supabase: any,
  orderId: string,
  shippingBaseFeeUsd: number,
  shippingPercent: number,
  exchangeRate: number
): Promise<OrderTotals | null> {
  // Query all items including vehicle flags and stored shipping
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('base_price_usd, subtotal_usd, markup_fee_usd, shipping_fee_usd, total_price_usd, quantity, est_weight_kg, requires_manual_quote, is_saved_for_later, is_vehicle, vehicle_quote_applied')
    .eq('order_id', orderId);

  if (itemsError) {
    console.error('[updateOrderTotals] Failed to fetch items:', itemsError);
    return null;
  }

  // Track regular items and vehicles separately
  let regularItemBaseTotal = 0;    // Sum of regular item base prices
  let regularItemMarginTotal = 0;  // Sum of regular item margins
  let regularRequiresQuote = false;
  let regularItemCount = 0;

  // Vehicle totals - vehicles with applied quotes use STORED values
  let vehicleBasePriceTotal = 0;   // Sum of vehicle base prices
  let vehicleMarginTotal = 0;      // Sum of vehicle margins
  let vehicleShippingTotal = 0;    // Sum of vehicle shipping
  let vehicleItemCount = 0;
  let hasVehiclePendingQuote = false;

  // Calculate totals from ACTIVE items only (not saved for later)
  (items || []).forEach((item: any) => {
    if (item.is_saved_for_later) return; // Skip saved items

    const isVehicle = item.is_vehicle === true;
    const vehicleQuoteApplied = item.vehicle_quote_applied === true;

    if (isVehicle) {
      vehicleItemCount++;
      
      if (vehicleQuoteApplied) {
        // Vehicle WITH quote: use STORED values
        const storedBase = Number(item.base_price_usd || 0);
        const storedMargin = Number(item.markup_fee_usd || 0);
        const storedShipping = Number(item.shipping_fee_usd || 0);
        
        vehicleBasePriceTotal += storedBase;
        vehicleMarginTotal += storedMargin;
        vehicleShippingTotal += storedShipping;
        
        console.log('[updateOrderTotals] Vehicle with quote:', {
          base: storedBase,
          margin: storedMargin,
          shipping: storedShipping,
        });
      } else {
        // Vehicle WITHOUT quote: include estimated base and margin, but mark as pending
        const basePrice = Number(item.base_price_usd || 0);
        const estimatedMargin = Number(item.markup_fee_usd || 0);
        
        vehicleBasePriceTotal += basePrice;
        vehicleMarginTotal += estimatedMargin;
        // No shipping for pending vehicles
        
        hasVehiclePendingQuote = true;
        console.log('[updateOrderTotals] Vehicle pending quote:', { base: basePrice, margin: estimatedMargin });
      }
    } else {
      // Regular item
      const basePrice = Number(item.base_price_usd || item.subtotal_usd || 0);
      const margin = Number(item.markup_fee_usd || 0);
      // FIXED: Only vehicles require manual quote, NOT heavy items
      // Regular products never block checkout regardless of weight

      regularItemBaseTotal += basePrice;
      regularItemMarginTotal += margin;
      regularItemCount++;
      // Regular items never require manual quote - removed weight-based check
    }
  });

  // Calculate shipping for REGULAR items only (vehicles have stored shipping)
  let regularShippingFeeUsd = 0;
  if (!regularRequiresQuote && regularItemCount > 0) {
    regularShippingFeeUsd = calculateShipping(regularItemBaseTotal, shippingBaseFeeUsd, shippingPercent);
  }

  // Combined totals - INCLUDE BOTH regular AND vehicle values
  const activeItemCount = regularItemCount + vehicleItemCount;
  const requiresManualQuote = regularRequiresQuote || hasVehiclePendingQuote;
  
  // Item totals = base prices from regular items + vehicle base prices
  const itemTotalUsd = round2(regularItemBaseTotal + vehicleBasePriceTotal);
  
  // Service/margin fee = regular margins + vehicle margins
  const serviceFeeUsd = round2(regularItemMarginTotal + vehicleMarginTotal);
  
  // Total shipping = regular shipping + vehicle shipping
  const shippingFeeUsd = round2(regularShippingFeeUsd + vehicleShippingTotal);
  
  // Grand total = items + margins + shipping
  const totalUsd = round2(itemTotalUsd + serviceFeeUsd + shippingFeeUsd);
  const totalCdf = round2(totalUsd * exchangeRate);

  console.log('[updateOrderTotals] Calculated totals:', {
    orderId,
    activeItemCount,
    totalItemsInOrder: items?.length || 0,
    regularItems: { base: regularItemBaseTotal, margin: regularItemMarginTotal, shipping: regularShippingFeeUsd },
    vehicleItems: { base: vehicleBasePriceTotal, margin: vehicleMarginTotal, shipping: vehicleShippingTotal },
    combined: { items: itemTotalUsd, margin: serviceFeeUsd, shipping: shippingFeeUsd, total: totalUsd },
    requiresManualQuote,
  });

  // REGRESSION GUARD: Log warning if active items exist but total is 0
  if (activeItemCount > 0 && totalUsd === 0) {
    console.warn('[updateOrderTotals] REGRESSION WARNING: Active items exist but totalUsd = 0', {
      orderId,
      activeItemCount,
      itemTotalUsd,
      serviceFeeUsd,
    });
    
    // Log to ai_assistant_logs for admin visibility
    try {
      await supabase.from('ai_assistant_logs').insert({
        user_id: '00000000-0000-0000-0000-000000000000', // System user
        action_type: 'CART_REGRESSION_WARNING',
        metadata: {
          orderId,
          activeItemCount,
          itemTotalUsd,
          serviceFeeUsd,
          totalUsd,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (logError) {
      console.error('[updateOrderTotals] Failed to log regression warning:', logError);
    }
  }

  // Persist to orders table - ALWAYS use provided exchange rate (from settings)
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
    activeItemCount,
  };
}

// Re-export round2 for convenience
export { round2 };
