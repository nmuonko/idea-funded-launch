// Price Resolver Shared Utilities
// URL normalization, domain whitelist, store detection, TTL config

// Store types supported by AfriShop
// NOTE: carvana and cargurus are DEPRECATED for new items - use tesla_used or edmunds
export type StoreType = 
  | 'amazon' | 'walmart' | 'bestbuy' | 'ebay' | 'target' 
  | 'shein' | 'macys' | 'homedepot' 
  | 'mercari' | 'wayfair'  // Mercari (Used & Cheap) & Wayfair (Home/Furniture)
  | 'carvana' | 'cargurus'  // DEPRECATED: Keep for historical data compatibility
  | 'tesla_used' | 'edmunds'  // Active car stores
  | 'aliexpress' | 'generic';

// Active car store types (for new items)
export const ACTIVE_CAR_STORES: StoreType[] = ['tesla_used', 'edmunds'];

// Deprecated car store types (read-only for historical data)
export const DEPRECATED_CAR_STORES: StoreType[] = ['carvana', 'cargurus'];

// All car store types (active + deprecated)
export const ALL_CAR_STORES: StoreType[] = [...ACTIVE_CAR_STORES, ...DEPRECATED_CAR_STORES];

// Check if a store is a car marketplace
export function isCarStore(store: string): boolean {
  return ALL_CAR_STORES.includes(store.toLowerCase() as StoreType);
}

// Check if a car store is deprecated (for new items)
export function isDeprecatedCarStore(store: string): boolean {
  return DEPRECATED_CAR_STORES.includes(store.toLowerCase() as StoreType);
}

// Allowed domains for SSRF prevention
const ALLOWED_DOMAINS = [
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca', 'amazon.es', 'amazon.it', 'amazon.com.mx',
  'ebay.com', 'ebay.co.uk', 'ebay.de', 'ebay.fr', 'ebay.ca',
  'walmart.com',
  'bestbuy.com',
  'target.com',
  'aliexpress.com', 'aliexpress.us',
  'shein.com',
  'macys.com',
  'homedepot.com',
  'lowes.com',
  'costco.com',
  'newegg.com',
  // Mercari (Used & Cheap) & Wayfair (Home/Furniture)
  'mercari.com',
  'wayfair.com',
  // Car marketplaces (deprecated - kept for historical compatibility)
  'carvana.com',
  'cargurus.com',
  'autotrader.com',
  'cars.com',
  // Active car marketplaces
  'tesla.com',
  'edmunds.com',
];

// Tracking params to strip from URLs
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'tag', 'ref', 'fbclid', 'gclid', 'msclkid', 'dclid',
  'affiliate', 'clickid', 'source', 'camp', 'adid',
  '_ga', '_gl', 'mc_cid', 'mc_eid', 'yclid',
  'spm', 'scm', 'pvid', 'algo_pvid', 'algo_expid',
];

// Essential params to keep for product identification
const ESSENTIAL_PARAMS = [
  'id', 'asin', 'product', 'item', 'sku', 'pid', 'dp', 'productid',
  'listing', 'vin', 'vehicle', 'stock', 'model',
];

// TTL configuration per store (in hours) - STANDARD CACHE
// Shorter TTL for problematic/dynamic stores
export const STORE_TTL_HOURS: Record<string, number> = {
  amazon: 12,
  walmart: 12,
  bestbuy: 12,
  target: 12,
  macys: 12,
  homedepot: 24,
  ebay: 6,        // Prices change frequently (auctions)
  shein: 4,       // Flash sales, frequent price changes - shorter cache
  aliexpress: 4,  // Dynamic pricing - shorter cache
  // Mercari & Wayfair
  mercari: 6,     // Used items - moderate TTL
  wayfair: 12,    // Stable home furniture pricing
  // Car marketplaces (stable pricing)
  carvana: 48,    // DEPRECATED - kept for historical data
  cargurus: 48,   // DEPRECATED - kept for historical data
  tesla_used: 48, // Tesla used inventory
  edmunds: 48,    // Edmunds car listings
  generic: 8,     // Reduced generic TTL
};

// HOT CACHE TTL configuration (in minutes) - for frequently accessed products
// Very short TTL for near real-time responsiveness on repeat requests
export const HOT_CACHE_TTL_MINUTES: Record<string, number> = {
  amazon: 15,
  walmart: 15,
  bestbuy: 15,
  target: 15,
  macys: 15,
  homedepot: 20,
  ebay: 5,        // Auctions change frequently
  shein: 5,       // Very short due to dynamic pricing
  aliexpress: 5,  // Very short due to dynamic pricing
  // Mercari & Wayfair
  mercari: 10,    // Used items - moderate TTL
  wayfair: 15,    // Stable pricing
  // Car marketplaces - longer hot cache (stable pricing)
  carvana: 30,
  cargurus: 30,
  tesla_used: 30,
  edmunds: 30,
  generic: 10,
};

/**
 * Get hot cache TTL for a store (in milliseconds)
 */
export function getHotCacheTtlForStore(store: string): number {
  const minutes = HOT_CACHE_TTL_MINUTES[store] ?? HOT_CACHE_TTL_MINUTES.generic;
  return minutes * 60 * 1000;
}

// Currency mappings
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'CA$',
  AUD: 'A$',
  JPY: '¥',
  CNY: '¥',
  CDF: 'FC',
  MXN: 'MX$',
};

/**
 * Normalize a URL for consistent caching
 * - Lowercase hostname
 * - Strip tracking params
 * - Keep essential product params
 * - Remove fragments
 */
export function normalizeUrl(url: string): { normalizedUrl: string; error?: string } {
  try {
    const urlObj = new URL(url.trim());
    
    // Force lowercase hostname
    const hostname = urlObj.hostname.toLowerCase();
    
    // Build normalized URL
    let normalized = `${urlObj.protocol}//${hostname}${urlObj.pathname}`;
    
    // Filter query params
    const params = new URLSearchParams();
    for (const [key, value] of urlObj.searchParams) {
      const keyLower = key.toLowerCase();
      
      // Skip tracking params
      if (TRACKING_PARAMS.some(tp => keyLower === tp || keyLower.startsWith(`${tp}_`))) {
        continue;
      }
      
      // Keep essential params or short keys (likely product IDs)
      if (ESSENTIAL_PARAMS.some(ep => keyLower.includes(ep)) || key.length <= 3) {
        params.set(key, value);
      }
    }
    
    const paramStr = params.toString();
    if (paramStr) {
      normalized += `?${paramStr}`;
    }
    
    return { normalizedUrl: normalized };
  } catch {
    return { normalizedUrl: '', error: 'INVALID_URL' };
  }
}

/**
 * Check if URL is in allowed domain whitelist
 */
export function isAllowedDomain(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    return ALLOWED_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Check if URL points to private/internal address
 */
export function isPrivateUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return true;
    }
    
    // Check for private IP ranges
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      if (a === 10) return true;                    // 10.x.x.x
      if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16-31.x.x
      if (a === 192 && b === 168) return true;      // 192.168.x.x
      if (a === 169 && b === 254) return true;      // Link-local
      if (a === 127) return true;                   // Loopback
    }
    
    return false;
  } catch {
    return true; // Reject invalid URLs
  }
}

/**
 * Detect store type from URL
 */
export function detectStore(url: string): StoreType {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.toLowerCase();
    
    if (host.includes('amazon.')) return 'amazon';
    if (host.includes('walmart.')) return 'walmart';
    if (host.includes('bestbuy.')) return 'bestbuy';
    if (host.includes('ebay.')) return 'ebay';
    if (host.includes('target.')) return 'target';
    if (host.includes('aliexpress.')) return 'aliexpress';
    if (host.includes('shein.')) return 'shein';
    if (host.includes('macys.')) return 'macys';
    if (host.includes('homedepot.')) return 'homedepot';
    // Mercari & Wayfair
    if (host.includes('mercari.')) return 'mercari';
    if (host.includes('wayfair.')) return 'wayfair';
    // Active car stores (preferred)
    if (host.includes('tesla.') && pathname.includes('/inventory')) return 'tesla_used';
    if (host.includes('edmunds.')) return 'edmunds';
    // DEPRECATED: Car stores (kept for backward compatibility)
    if (host.includes('carvana.')) return 'carvana';
    if (host.includes('cargurus.')) return 'cargurus';
    
    return 'generic';
  } catch {
    return 'generic';
  }
}

/**
 * Get human-readable label for a store type
 * Includes (deprecated) suffix for old car stores
 */
export function getStoreLabel(store: string): string {
  const labels: Record<string, string> = {
    amazon: 'Amazon',
    walmart: 'Walmart',
    bestbuy: 'Best Buy',
    ebay: 'eBay',
    target: 'Target',
    aliexpress: 'AliExpress',
    shein: 'SHEIN',
    macys: "Macy's",
    homedepot: 'Home Depot',
    // Mercari & Wayfair
    mercari: 'Mercari',
    wayfair: 'Wayfair',
    // Active car stores
    tesla_used: 'Tesla Used',
    edmunds: 'Edmunds',
    // Deprecated car stores
    carvana: 'Carvana (deprecated)',
    cargurus: 'CarGurus (deprecated)',
    generic: 'Other',
  };
  return labels[store.toLowerCase()] || store;
}

/**
 * Get cache TTL for a store (in milliseconds)
 */
export function getTtlForStore(store: string): number {
  const hours = STORE_TTL_HOURS[store] ?? STORE_TTL_HOURS.generic;
  return hours * 60 * 60 * 1000;
}

/**
 * Get currency symbol from currency code
 */
export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? '$';
}

/**
 * Detect currency from text content and URL
 * IMPORTANT: US stores (SHEIN US, Amazon, Walmart, etc.) always use USD
 */
export function detectCurrency(text: string, url: string): { code: string; symbol: string } {
  // Force USD for ALL major US stores - this is the most reliable approach
  // These stores NEVER sell in CDF regardless of page content
  const forceUsdDomains = [
    'amazon.com', 'walmart.com', 'bestbuy.com', 'target.com',
    'homedepot.com', 'macys.com', 'ebay.com', 'newegg.com', 'costco.com',
    'shein.com', 'us.shein.com', 'm.shein.com',
    'mercari.com', 'wayfair.com',
    'carvana.com', 'cargurus.com', 'tesla.com', 'edmunds.com', 'autotrader.com', 'cars.com'
  ];
  
  const urlLower = url.toLowerCase();
  for (const domain of forceUsdDomains) {
    if (urlLower.includes(domain)) {
      return { code: 'USD', symbol: '$' };
    }
  }
  
  // Check URL for domain hints first
  if (url.includes('.co.uk') || url.includes('.uk')) {
    return { code: 'GBP', symbol: '£' };
  }
  if (url.includes('.de') || url.includes('.fr') || url.includes('.it') || url.includes('.es')) {
    return { code: 'EUR', symbol: '€' };
  }
  if (url.includes('.ca')) {
    return { code: 'CAD', symbol: 'CA$' };
  }
  if (url.includes('.com.mx') || url.includes('.mx')) {
    return { code: 'MXN', symbol: 'MX$' };
  }
  
  // Check text for currency symbols/codes - but be very careful with false positives
  if (/£|GBP/i.test(text)) return { code: 'GBP', symbol: '£' };
  if (/€|EUR/i.test(text)) return { code: 'EUR', symbol: '€' };
  if (/CA\$|CAD/i.test(text)) return { code: 'CAD', symbol: 'CA$' };
  
  // NEVER detect CDF from page content - too many false positives
  // CDF should only be used when explicitly set by backend pricing logic
  
  // Default to USD - this is the safest assumption for e-commerce
  return { code: 'USD', symbol: '$' };
}

/**
 * Clean and parse a price string to a number
 */
export function cleanPriceString(rawText: string): number | null {
  if (!rawText || typeof rawText !== 'string') return null;
  
  // Remove currency symbols, whitespace, non-breaking spaces
  let cleaned = rawText
    .replace(/[$€£¥₹₦CA\$A\$MX\$\u00A0\s]/g, '')
    .replace(/USD|EUR|GBP|CDF|FC|CAD|AUD|MXN/gi, '')
    .trim();
  
  if (!cleaned) return null;
  
  // Handle different number formats
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  
  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    
    if (lastComma > lastDot) {
      // EU format: 1.299,99
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 1,299.99
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      // Likely EU decimal: 299,99
      cleaned = cleaned.replace(',', '.');
    } else {
      // Likely thousands: 1,299
      cleaned = cleaned.replace(/,/g, '');
    }
  }
  
  const price = parseFloat(cleaned);
  
  // Validate: positive, finite, reasonable range
  if (isNaN(price) || !isFinite(price) || price <= 0 || price > 1000000) {
    return null;
  }
  
  return Math.round(price * 100) / 100;
}

/**
 * Format price for display
 */
export function formatDisplayPrice(price: number, currencyCode: string): string {
  const symbol = getCurrencySymbol(currencyCode);
  
  if (currencyCode === 'CDF') {
    return `${symbol} ${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  
  return `${symbol}${price.toFixed(2)}`;
}
