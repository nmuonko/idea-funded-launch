/**
 * Global Price Capture Cache for WebView tap-to-pick flow
 * 
 * This module provides utilities for caching captured prices from WebView
 * to improve accuracy and speed across users without overloading the backend.
 */

import { supabase } from "@/integrations/supabase/client";

// Store-specific TTL in minutes
const STORE_TTL_MINUTES: Record<string, number> = {
  amazon: 720,      // 12 hours
  ebay: 1440,       // 24 hours
  shein: 1440,      // 24 hours
  walmart: 1440,    // 24 hours
  bestbuy: 1440,    // 24 hours
  target: 1440,     // 24 hours
  temu: 720,        // 12 hours
  wayfair: 1440,    // 24 hours
  tesla: 2880,      // 48 hours
  tesla_used: 2880, // 48 hours
  carvana: 2880,    // 48 hours
  cargurus: 2880,   // 48 hours
  edmunds: 2880,    // 48 hours
};

const DEFAULT_TTL_MINUTES = 720; // 12 hours

export type PriceCaptureSource = 'tap' | 'auto' | 'manual';

export interface CachedPrice {
  id: string;
  store: string;
  product_key: string;
  canonical_url: string | null;
  title: string | null;
  price_value: number;
  currency: string;
  source: PriceCaptureSource;
  confidence: number;
  captured_at: string;
  expires_at: string;
  capture_count: number;
  last_seen_at: string;
  is_expired: boolean;
}

export interface UpsertResult {
  success: boolean;
  action?: 'inserted' | 'updated' | 'skipped';
  id?: string;
  expires_at?: string;
  error?: string;
}

/**
 * Extract a stable product key from a URL
 * - Amazon: ASIN from /dp/{ASIN} or /gp/product/{ASIN}
 * - eBay: item id from /itm/{id}
 * - Others: canonical URL (stripped query params) or hash
 */
export function extractProductKey(url: string, store: string): string {
  try {
    const parsedUrl = new URL(url);
    const lowerStore = store.toLowerCase();
    
    // Amazon: Extract ASIN
    if (lowerStore === 'amazon') {
      // Match /dp/{ASIN} or /gp/product/{ASIN}
      const dpMatch = parsedUrl.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
      if (dpMatch) return dpMatch[1].toUpperCase();
      
      const gpMatch = parsedUrl.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      if (gpMatch) return gpMatch[1].toUpperCase();
      
      // Fallback to ASIN query param
      const asinParam = parsedUrl.searchParams.get('ASIN') || parsedUrl.searchParams.get('asin');
      if (asinParam) return asinParam.toUpperCase();
    }
    
    // eBay: Extract item ID
    if (lowerStore === 'ebay') {
      // Match /itm/{id} or /itm/{title}/{id}
      const itmMatch = parsedUrl.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/);
      if (itmMatch) return itmMatch[1];
      
      // Check for item param
      const itemParam = parsedUrl.searchParams.get('item');
      if (itemParam) return itemParam;
    }
    
    // Walmart: Extract product ID
    if (lowerStore === 'walmart') {
      const ipMatch = parsedUrl.pathname.match(/\/ip\/[^/]+\/(\d+)/);
      if (ipMatch) return ipMatch[1];
      
      const ipSimpleMatch = parsedUrl.pathname.match(/\/ip\/(\d+)/);
      if (ipSimpleMatch) return ipSimpleMatch[1];
    }
    
    // Best Buy: Extract SKU
    if (lowerStore === 'bestbuy') {
      const skuMatch = parsedUrl.pathname.match(/\/(\d{7,})\./);
      if (skuMatch) return skuMatch[1];
      
      const pMatch = parsedUrl.pathname.match(/\/p\/[^/]+\/(\d+)/);
      if (pMatch) return pMatch[1];
    }
    
    // Target: Extract DPCI or product ID
    if (lowerStore === 'target') {
      const aMatch = parsedUrl.pathname.match(/\/A-(\d+)/);
      if (aMatch) return `A-${aMatch[1]}`;
    }
    
    // Temu: Extract product ID from path
    if (lowerStore === 'temu') {
      const temuMatch = parsedUrl.pathname.match(/\/(\d+)\.html/);
      if (temuMatch) return temuMatch[1];
    }
    
    // Default: Use canonical path (no query params)
    return parsedUrl.pathname.replace(/\/$/, '') || parsedUrl.href;
    
  } catch (error) {
    console.warn('[PriceCache] Failed to parse URL for product key:', error);
    // Fallback: use URL as-is
    return url;
  }
}

/**
 * Get canonical URL by stripping query parameters and normalizing
 */
export function getCanonicalUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    // Keep only the essential parts
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Get TTL in minutes for a given store
 */
export function getStoreTTL(store: string): number {
  return STORE_TTL_MINUTES[store.toLowerCase()] || DEFAULT_TTL_MINUTES;
}

/**
 * Fetch cached price for a product
 * Returns null if not found or if there's an error
 */
export async function getCachedPrice(
  store: string,
  productKey: string
): Promise<CachedPrice | null> {
  try {
    const startTime = Date.now();
    
    const { data, error } = await supabase.rpc('get_cached_price', {
      store_input: store.toLowerCase(),
      product_key_input: productKey,
    });
    
    const duration = Date.now() - startTime;
    
    if (error) {
      console.error('[PriceCache] Error fetching cached price:', error);
      return null;
    }
    
    if (!data || data.length === 0) {
      console.log(`[PriceCache] Cache MISS: store=${store}, key=${productKey}, duration=${duration}ms`);
      return null;
    }
    
    const cached = data[0] as CachedPrice;
    console.log(
      `[PriceCache] Cache ${cached.is_expired ? 'EXPIRED' : 'HIT'}: ` +
      `store=${store}, key=${productKey}, price=${cached.price_value} ${cached.currency}, ` +
      `source=${cached.source}, confidence=${cached.confidence}, duration=${duration}ms`
    );
    
    return cached;
    
  } catch (error) {
    console.error('[PriceCache] Exception fetching cached price:', error);
    return null;
  }
}

/**
 * Upsert a price into the cache
 * Only updates if the new entry has higher or equal confidence, 
 * or if existing entry is expired, or if source is 'tap'
 */
export async function upsertCachedPrice(params: {
  store: string;
  productKey: string;
  canonicalUrl?: string;
  title?: string;
  priceValue: number;
  currency?: string;
  source: PriceCaptureSource;
  confidence: number;
  ttlMinutes?: number;
}): Promise<UpsertResult> {
  const {
    store,
    productKey,
    canonicalUrl,
    title,
    priceValue,
    currency = 'USD',
    source,
    confidence,
    ttlMinutes = getStoreTTL(store),
  } = params;
  
  try {
    // Validate confidence requirements
    if (source === 'auto' && confidence < 0.85) {
      console.warn('[PriceCache] Skipping cache upsert: auto source requires confidence >= 0.85');
      return { success: false, error: 'Auto source requires confidence >= 0.85' };
    }
    
    if (source === 'manual' && confidence < 0.95) {
      console.warn('[PriceCache] Skipping cache upsert: manual source requires confidence >= 0.95');
      return { success: false, error: 'Manual source requires confidence >= 0.95' };
    }
    
    const startTime = Date.now();
    
    const { data, error } = await supabase.rpc('upsert_cached_price', {
      store_input: store.toLowerCase(),
      product_key_input: productKey,
      canonical_url_input: canonicalUrl || null,
      title_input: title || null,
      price_value_input: priceValue,
      currency_input: currency,
      source_input: source,
      confidence_input: confidence,
      ttl_minutes: ttlMinutes,
    });
    
    const duration = Date.now() - startTime;
    
    if (error) {
      console.error('[PriceCache] Error upserting price:', error);
      return { success: false, error: error.message };
    }
    
    if (!data || typeof data !== 'object') {
      return { success: false, error: 'Invalid response from upsert' };
    }
    
    const result = data as unknown as UpsertResult;
    console.log(
      `[PriceCache] Upsert ${result.action}: store=${store}, key=${productKey}, ` +
      `price=${priceValue} ${currency}, source=${source}, confidence=${confidence}, ` +
      `ttl=${ttlMinutes}min, duration=${duration}ms`
    );
    
    return result;
    
  } catch (error) {
    console.error('[PriceCache] Exception upserting price:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Check if extracted price matches cached price (within tolerance)
 */
export function pricesMatch(
  extractedPrice: number,
  cachedPrice: number,
  toleranceUsd: number = 0.01
): boolean {
  return Math.abs(extractedPrice - cachedPrice) <= toleranceUsd;
}

/**
 * Determine action based on cache lookup and extraction result
 */
export interface PriceCacheDecision {
  action: 'use_cached' | 'use_extracted' | 'require_tap' | 'show_cached_reference';
  price: number;
  currency: string;
  confidence: number;
  source: PriceCaptureSource | 'extracted';
  cachedPrice?: CachedPrice;
  reason: string;
}

export function decidePriceAction(params: {
  cachedPrice: CachedPrice | null;
  extractedPrice: number | null;
  extractedConfidence?: number;
}): PriceCacheDecision {
  const { cachedPrice, extractedPrice, extractedConfidence = 0.9 } = params;
  
  // Case 1: No cache, no extraction -> require tap
  if (!cachedPrice && extractedPrice === null) {
    return {
      action: 'require_tap',
      price: 0,
      currency: 'USD',
      confidence: 0,
      source: 'extracted',
      reason: 'No cached price and auto extraction failed',
    };
  }
  
  // Case 2: No cache, but extraction succeeded -> use extracted
  if (!cachedPrice && extractedPrice !== null) {
    return {
      action: 'use_extracted',
      price: extractedPrice,
      currency: 'USD',
      confidence: extractedConfidence,
      source: 'extracted',
      reason: 'No cached price, using auto-extracted price',
    };
  }
  
  // Case 3: Cache exists but expired
  if (cachedPrice && cachedPrice.is_expired) {
    if (extractedPrice !== null) {
      // Check if matches expired cache
      if (pricesMatch(extractedPrice, cachedPrice.price_value)) {
        return {
          action: 'use_extracted',
          price: extractedPrice,
          currency: cachedPrice.currency,
          confidence: 0.95, // Boost confidence when matches old cache
          source: 'extracted',
          cachedPrice,
          reason: 'Extracted price matches expired cache, high confidence',
        };
      }
      // Mismatch with expired cache -> require tap to verify
      return {
        action: 'require_tap',
        price: extractedPrice,
        currency: 'USD',
        confidence: 0.5,
        source: 'extracted',
        cachedPrice,
        reason: 'Extracted price differs from expired cache, verification needed',
      };
    }
    // Expired cache, no extraction -> show as reference but require tap
    return {
      action: 'show_cached_reference',
      price: cachedPrice.price_value,
      currency: cachedPrice.currency,
      confidence: 0.3,
      source: cachedPrice.source,
      cachedPrice,
      reason: 'Cache expired and extraction failed, showing old price as reference',
    };
  }
  
  // Case 4: Fresh cache exists
  if (cachedPrice && !cachedPrice.is_expired) {
    if (extractedPrice !== null) {
      // Check if extracted matches cached
      if (pricesMatch(extractedPrice, cachedPrice.price_value)) {
        return {
          action: 'use_cached',
          price: cachedPrice.price_value,
          currency: cachedPrice.currency,
          confidence: 0.95, // High confidence when both agree
          source: cachedPrice.source,
          cachedPrice,
          reason: 'Extracted price matches fresh cache',
        };
      }
      // Mismatch -> require tap to resolve
      return {
        action: 'require_tap',
        price: extractedPrice,
        currency: 'USD',
        confidence: 0.5,
        source: 'extracted',
        cachedPrice,
        reason: `Price mismatch: extracted $${extractedPrice} vs cached $${cachedPrice.price_value}`,
      };
    }
    // Fresh cache, no extraction -> use cached
    return {
      action: 'use_cached',
      price: cachedPrice.price_value,
      currency: cachedPrice.currency,
      confidence: cachedPrice.confidence,
      source: cachedPrice.source,
      cachedPrice,
      reason: 'Using fresh cached price (extraction failed)',
    };
  }
  
  // Fallback
  return {
    action: 'require_tap',
    price: 0,
    currency: 'USD',
    confidence: 0,
    source: 'extracted',
    reason: 'Unexpected state, requiring tap verification',
  };
}

/**
 * Format cached price info for display
 */
export function formatCachedPriceInfo(cached: CachedPrice): string {
  const capturedDate = new Date(cached.captured_at);
  const now = new Date();
  const diffMs = now.getTime() - capturedDate.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  let timeAgo: string;
  if (diffHours > 0) {
    timeAgo = `il y a ${diffHours}h${diffMinutes > 0 ? ` ${diffMinutes}min` : ''}`;
  } else {
    timeAgo = `il y a ${diffMinutes} min`;
  }
  
  return `${cached.currency === 'USD' ? '$' : cached.currency}${cached.price_value.toFixed(2)} (${timeAgo})`;
}
