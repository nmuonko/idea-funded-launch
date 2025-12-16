// Shared cart helpers - single source of truth for cart calculations
// Used by: mobile-add-cart-item, mobile-update-cart-item, mobile-delete-cart-item, cart-sync-from-client

import { getCachedSettings, round2 } from "./settings-cache.ts";

// Heavy item threshold for manual quote requirement
export const HEAVY_THRESHOLD_KG = 9;

// Calculate pricing for an item
export function calculateItemPricing(
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

// Dynamic shipping calculation: base + (percentage × items subtotal)
export function calculateShipping(
  itemsSubtotal: number, 
  shippingBaseFee: number, 
  shippingPercent: number
): number {
  return round2(shippingBaseFee + (itemsSubtotal * shippingPercent));
}

// Detect store from URL
// NOTE: CARVANA and CARGURUS are DEPRECATED for new items - use TESLA_USED or EDMUNDS
export function detectStore(productUrl: string): string {
  try {
    const urlObj = new URL(productUrl);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();
    
    if (hostname.includes('amazon')) return 'AMAZON';
    if (hostname.includes('ebay')) return 'EBAY';
    if (hostname.includes('walmart')) return 'WALMART';
    if (hostname.includes('bestbuy')) return 'BESTBUY';
    // NEW: Active car stores (preferred)
    if (hostname.includes('tesla') && pathname.includes('/inventory')) return 'TESLA_USED';
    if (hostname.includes('edmunds')) return 'EDMUNDS';
    // DEPRECATED: Car stores (kept for backward compatibility)
    if (hostname.includes('carvana')) return 'CARVANA';
    if (hostname.includes('cargurus')) return 'CARGURUS';
    return 'OTHER';
  } catch {
    return 'OTHER';
  }
}

// Active car stores that should be used for new items
export const ACTIVE_CAR_STORES_ENUM = ['TESLA_USED', 'EDMUNDS'];

// Deprecated car stores (still valid for historical data)
export const DEPRECATED_CAR_STORES_ENUM = ['CARVANA', 'CARGURUS'];

// All car stores (for vehicle detection)
export const ALL_CAR_STORES_ENUM = [...ACTIVE_CAR_STORES_ENUM, ...DEPRECATED_CAR_STORES_ENUM];

// Check if store is a car marketplace
export function isCarStoreEnum(store: string): boolean {
  return ALL_CAR_STORES_ENUM.includes(store.toUpperCase());
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
 * Calculate and persist order totals from ACTIVE items only (excluding saved-for-later)
 * This is the SINGLE SOURCE OF TRUTH for order total calculations.
 * 
 * CRITICAL: This function NEVER deletes cart data on errors - it only updates totals or returns null.
 */
export async function updateOrderTotals(
  supabase: any,
  orderId: string,
  shippingBaseFeeUsd: number,
  shippingPercent: number,
  exchangeRate: number
): Promise<OrderTotals | null> {
  // Query all items with is_saved_for_later flag for proper filtering
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

  // Calculate totals from ACTIVE items only (not saved for later)
  (items || []).forEach((item: any) => {
    if (!item.is_saved_for_later) {
      const subtotal = Number(item.subtotal_usd || 0);
      const markup = Number(item.markup_fee_usd || 0);
      const total = Number(item.total_price_usd || 0);
      const estWeight = Number(item.est_weight_kg || 1);
      const itemRequiresQuote = item.requires_manual_quote || estWeight > HEAVY_THRESHOLD_KG;

      itemTotalUsd += subtotal;
      serviceFeeUsd += markup;
      itemsWithMarkupUsd += total;
      activeItemCount++;

      if (itemRequiresQuote) {
        requiresManualQuote = true;
      }
    }
  });

  // Only calculate shipping for active items that don't require manual quote
  let shippingFeeUsd = 0;
  if (!requiresManualQuote && activeItemCount > 0) {
    shippingFeeUsd = calculateShipping(itemTotalUsd, shippingBaseFeeUsd, shippingPercent);
  }
  
  const totalUsd = round2(itemsWithMarkupUsd + shippingFeeUsd);
  const totalCdf = round2(totalUsd * exchangeRate);

  console.log('[updateOrderTotals] Calculated totals:', {
    orderId,
    activeItemCount,
    totalItemsInOrder: items?.length || 0,
    itemTotalUsd: round2(itemTotalUsd),
    serviceFeeUsd: round2(serviceFeeUsd),
    shippingFeeUsd: round2(shippingFeeUsd),
    totalUsd,
    totalCdf,
    requiresManualQuote,
  });

  // REGRESSION GUARD: Log warning if active items exist but total is 0
  if (activeItemCount > 0 && totalUsd === 0) {
    console.warn('[updateOrderTotals] REGRESSION WARNING: Active items exist but totalUsd = 0', {
      orderId,
      activeItemCount,
      itemTotalUsd,
      serviceFeeUsd,
      itemsWithMarkupUsd,
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
    activeItemCount,
  };
}

// Re-export round2 for convenience
export { round2 };
