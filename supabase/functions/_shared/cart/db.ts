/**
 * Cart Database Module
 * PostgREST-based database operations for cart
 */

import { PostgrestClient, PostgrestResult } from "../postgrest.ts";

export interface CartSettings {
  markupPercent: number;
  vehicleMarkupPercent: number;
  exchangeRate: number;
  shippingBaseFeeUsd: number;
  shippingPercent: number;
  vehiclePricingTiers?: Record<string, unknown> | null;
}

export interface ShippingType {
  id: string;
  estWeightKg: number;
  requiresManualQuote: boolean;
  flatShippingUsd: number | null;
  shippingBufferPercent: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_url: string;
  quantity: number;
  base_price_usd: number;
  [key: string]: unknown;
}

export interface DraftOrder {
  id: string;
  user_id: string;
  status: string;
  [key: string]: unknown;
}

/**
 * Get or create draft order (cart) for user
 */
export async function getOrCreateDraftOrder(
  db: PostgrestClient,
  userId: string,
  correlationId: string
): Promise<PostgrestResult<DraftOrder>> {
  // First try to find existing draft
  const existingResult = await db.from<DraftOrder[]>("orders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "DRAFT")
    .order("created_at", { ascending: false })
    .limit(1);
  
  if (existingResult.error) {
    console.error(`[CART_ADD] ${correlationId} Error fetching draft:`, existingResult.error.message);
    return { data: null, error: existingResult.error, status: existingResult.status };
  }
  
  if (existingResult.data && existingResult.data.length > 0) {
    console.log(`[CART_ADD] ${correlationId} Found existing draft: ${existingResult.data[0].id}`);
    return { data: existingResult.data[0], error: null, status: 200 };
  }

  // RACE CONDITION FIX: Check for a recent PENDING_PAYMENT order before creating a new draft.
  // This prevents duplicates when cart sync runs after checkout converts DRAFT → PENDING_PAYMENT.
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const pendingResult = await db.from<DraftOrder[]>("orders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "PENDING_PAYMENT")
    .gte("updated_at", thirtyMinutesAgo)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (pendingResult.data && pendingResult.data.length > 0) {
    console.log(`[CART_ADD] ${correlationId} Found recent PENDING_PAYMENT order, reusing: ${pendingResult.data[0].id}`);
    return { data: pendingResult.data[0], error: null, status: 200 };
  }
  
  // Create new draft order
  const insertResult = await db.from<DraftOrder[]>("orders")
    .insert({ user_id: userId, status: "DRAFT" })
    .select("*");
  
  if (insertResult.error) {
    console.error(`[CART_ADD] ${correlationId} Error creating draft:`, insertResult.error.message);
    return { data: null, error: insertResult.error, status: insertResult.status };
  }
  
  if (insertResult.data && insertResult.data.length > 0) {
    console.log(`[CART_ADD] ${correlationId} Created new draft: ${insertResult.data[0].id}`);
    return { data: insertResult.data[0], error: null, status: 201 };
  }
  
  return { data: null, error: { message: "Failed to create draft order" }, status: 500 };
}

/**
 * Find existing cart item by product URL
 */
export async function findExistingCartItem(
  db: PostgrestClient,
  orderId: string,
  productUrl: string,
  correlationId: string
): Promise<PostgrestResult<OrderItem | null>> {
  const result = await db.from<OrderItem[]>("order_items")
    .select("*")
    .eq("order_id", orderId)
    .eq("product_url", productUrl)
    .eq("is_saved_for_later", false)
    .limit(1);
  
  if (result.error) {
    console.error(`[CART_ADD] ${correlationId} Error finding item:`, result.error.message);
    return { data: null, error: result.error, status: result.status };
  }
  
  const item = result.data && result.data.length > 0 ? result.data[0] : null;
  return { data: item, error: null, status: 200 };
}

/**
 * Update existing cart item (merge quantities)
 */
export async function updateCartItem(
  db: PostgrestClient,
  itemId: string,
  updates: Record<string, unknown>,
  correlationId: string
): Promise<PostgrestResult<OrderItem>> {
  const result = await db.from<OrderItem[]>("order_items")
    .update(updates)
    .eq("id", itemId)
    .select("*");
  
  if (result.error) {
    console.error(`[CART_ADD] ${correlationId} Error updating item:`, result.error.message);
    return { data: null, error: result.error, status: result.status };
  }
  
  if (result.data && result.data.length > 0) {
    return { data: result.data[0], error: null, status: 200 };
  }
  
  return { data: null, error: { message: "Item not found after update" }, status: 404 };
}

/**
 * Insert new cart item
 */
export async function insertCartItem(
  db: PostgrestClient,
  item: Record<string, unknown>,
  correlationId: string
): Promise<PostgrestResult<OrderItem>> {
  const result = await db.from<OrderItem[]>("order_items")
    .insert(item)
    .select("*");
  
  if (result.error) {
    console.error(`[CART_ADD] ${correlationId} Error inserting item:`, result.error.message);
    return { data: null, error: result.error, status: result.status };
  }
  
  if (result.data && result.data.length > 0) {
    console.log(`[CART_ADD] ${correlationId} Inserted item: ${result.data[0].id}`);
    return { data: result.data[0], error: null, status: 201 };
  }
  
  return { data: null, error: { message: "Failed to insert item" }, status: 500 };
}

/**
 * Get shipping type by ID
 */
export async function getShippingType(
  db: PostgrestClient,
  shippingTypeId: string,
  correlationId: string
): Promise<PostgrestResult<ShippingType | null>> {
  const result = await db.from<{ id: string; est_weight_kg: number; requires_manual_quote: boolean }[]>("shipping_item_types")
    .select("id, est_weight_kg, requires_manual_quote")
    .eq("id", shippingTypeId)
    .eq("active", true)
    .limit(1);
  
  if (result.error) {
    console.error(`[CART_ADD] ${correlationId} Error fetching shipping type:`, result.error.message);
    return { data: null, error: result.error, status: result.status };
  }
  
  if (result.data && result.data.length > 0) {
    const row = result.data[0];
    return {
      data: {
        id: row.id,
        estWeightKg: row.est_weight_kg,
        requiresManualQuote: row.requires_manual_quote,
      },
      error: null,
      status: 200,
    };
  }
  
  return { data: null, error: null, status: 200 };
}

/**
 * Get shipping type ID for a category
 */
export async function getShippingTypeForCategory(
  db: PostgrestClient,
  category: string,
  correlationId: string
): Promise<PostgrestResult<ShippingType | null>> {
  const result = await db.from<{ id: string; est_weight_kg: number; requires_manual_quote: boolean }[]>("shipping_item_types")
    .select("id, est_weight_kg, requires_manual_quote")
    .eq("category_key", category)
    .eq("active", true)
    .limit(1);
  
  if (result.error) {
    return { data: null, error: result.error, status: result.status };
  }
  
  if (result.data && result.data.length > 0) {
    const row = result.data[0];
    return {
      data: {
        id: row.id,
        estWeightKg: row.est_weight_kg,
        requiresManualQuote: row.requires_manual_quote,
      },
      error: null,
      status: 200,
    };
  }
  
  return { data: null, error: null, status: 200 };
}

/**
 * Call RPC to update order totals
 */
export async function callUpdateOrderTotals(
  db: PostgrestClient,
  orderId: string,
  correlationId: string
): Promise<PostgrestResult<unknown>> {
  // Note: This uses the shared cartHelpers.updateOrderTotals logic
  // For now, we just return success - the actual update is done separately
  return { data: { success: true }, error: null, status: 200 };
}

/**
 * Get cached settings
 */
export async function getCachedSettings(
  db: PostgrestClient,
  correlationId: string
): Promise<PostgrestResult<CartSettings>> {
  const result = await db.from<{
    markup_percent?: number;
    global_markup_percent?: number;
    exchange_rate_usd_to_cdf: number;
    shipping_base_fee_usd: number;
    shipping_percent: number;
    category_markups?: Record<string, number> | null;
    vehicle_pricing_tiers?: Record<string, unknown> | null;
  }[]>("settings")
    .select("markup_percent, global_markup_percent, exchange_rate_usd_to_cdf, shipping_base_fee_usd, shipping_percent, category_markups, vehicle_pricing_tiers")
    .limit(1);
  
  if (result.error) {
    console.error(`[CART_ADD] ${correlationId} Error fetching settings:`, result.error.message);
    return { data: null, error: result.error, status: result.status };
  }
  
  if (!result.data || result.data.length === 0) {
    return { data: null, error: { message: "Settings not found" }, status: 404 };
  }
  
  const row = result.data[0];
  const generalMarkup = row.markup_percent ?? row.global_markup_percent ?? 15;
  const categoryMarkups = row.category_markups as Record<string, number> | null;
  const vehicleMarkup = categoryMarkups?.vehicles ?? generalMarkup;
  
  return {
    data: {
      markupPercent: generalMarkup,
      vehicleMarkupPercent: vehicleMarkup,
      exchangeRate: row.exchange_rate_usd_to_cdf,
      shippingBaseFeeUsd: row.shipping_base_fee_usd,
      shippingPercent: row.shipping_percent,
      vehiclePricingTiers: row.vehicle_pricing_tiers ?? null,
    },
    error: null,
    status: 200,
  };
}
