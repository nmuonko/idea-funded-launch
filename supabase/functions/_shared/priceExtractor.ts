/**
 * Robust Price Extractor for eBay and other providers
 * 
 * Supports multiple price field shapes and normalizes string formats.
 * Returns null if price cannot be extracted (never returns 0 silently).
 */

/**
 * Extract numeric price from various provider formats
 * 
 * @param rawItem - Raw provider item with any price shape
 * @param correlationId - Optional ID for logging
 * @returns price in USD as number, or null if extraction fails
 */
export function extractPriceUSD(
  rawItem: Record<string, unknown>,
  correlationId?: string
): number | null {
  // Ordered list of field paths to check
  const pricePaths: Array<() => unknown> = [
    // eBay Browse API v1 standard format
    () => (rawItem.price as Record<string, unknown>)?.value,
    () => (rawItem.price as Record<string, unknown>)?.amount,
    
    // eBay current price variations
    () => (rawItem.currentPrice as Record<string, unknown>)?.value,
    () => (rawItem.currentPrice as Record<string, unknown>)?.amount,
    
    // eBay sellingStatus (older API format)
    () => ((rawItem.sellingStatus as Record<string, unknown>)?.currentPrice as Record<string, unknown>)?.value,
    () => ((rawItem.sellingStatus as Record<string, unknown>)?.currentPrice as Record<string, unknown>)?.amount,
    
    // eBay pricingSummary
    () => ((rawItem.pricingSummary as Record<string, unknown>)?.price as Record<string, unknown>)?.value,
    
    // eBay buyingOptions array format
    () => {
      const opts = rawItem.buyingOptions as Array<Record<string, unknown>> | undefined;
      if (opts && opts.length > 0) {
        return (opts[0].price as Record<string, unknown>)?.value;
      }
      return undefined;
    },
    
    // itemPrice format
    () => (rawItem.itemPrice as Record<string, unknown>)?.value,
    () => (rawItem.itemPrice as Record<string, unknown>)?.amount,
    
    // Converted price (from other currencies)
    () => (rawItem.convertedCurrentPrice as Record<string, unknown>)?.value,
    () => (rawItem.convertedCurrentPrice as Record<string, unknown>)?.amount,
    
    // Direct numeric price field
    () => rawItem.priceUsd,
    () => rawItem.price_usd,
    
    // Display price string (e.g., "$219.95")
    () => rawItem.displayPrice,
    
    // Fallback: direct price if it's a number
    () => typeof rawItem.price === "number" ? rawItem.price : undefined,
  ];

  for (const getPrice of pricePaths) {
    try {
      const value = getPrice();
      if (value !== undefined && value !== null) {
        const normalized = normalizePrice(value);
        if (normalized !== null && normalized > 0) {
          return normalized;
        }
      }
    } catch {
      // Continue to next path
    }
  }

  // Log missing price for debugging
  if (correlationId) {
    const itemId = rawItem.itemId || rawItem.id || rawItem.provider_product_id || "unknown";
    const title = typeof rawItem.title === "string" ? rawItem.title.substring(0, 50) : "unknown";
    const sampleFields = {
      price: summarizeField(rawItem.price),
      currentPrice: summarizeField(rawItem.currentPrice),
      sellingStatus: summarizeField(rawItem.sellingStatus),
      pricingSummary: summarizeField(rawItem.pricingSummary),
      itemPrice: summarizeField(rawItem.itemPrice),
      convertedCurrentPrice: summarizeField(rawItem.convertedCurrentPrice),
      displayPrice: rawItem.displayPrice,
    };
    
    console.log(`[PRICE_MAP] missing provider=ebay itemId=${itemId} title="${title}" sampleFields=${JSON.stringify(sampleFields)}`);
  }

  return null;
}

/**
 * Normalize a price value from string or number to float
 * 
 * Handles formats like:
 * - "219.95"
 * - "$2,199.95"
 * - "1,299.00 USD"
 * - 219.95 (number)
 */
function normalizePrice(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  
  if (typeof value === "string") {
    // Remove currency symbols, letters, spaces, and normalize commas
    let cleaned = value
      .replace(/[A-Za-z$€£¥₹₽฿]/g, "")  // Remove currency symbols and letters
      .replace(/,/g, "")                   // Remove commas
      .replace(/\s+/g, "")                 // Remove spaces
      .trim();
    
    // Handle cases like "1.299,00" (European format)
    // If we have a single comma before the last 2-3 digits, it's a decimal separator
    if (cleaned.includes(".") && cleaned.lastIndexOf(".") !== cleaned.indexOf(".")) {
      // Multiple dots - might be European thousand separator
      cleaned = cleaned.replace(/\./g, "");
    }
    
    const parsed = parseFloat(cleaned);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  
  return null;
}

/**
 * Summarize a field for logging (avoid huge objects in logs)
 */
function summarizeField(field: unknown): string | null {
  if (field === undefined || field === null) return null;
  if (typeof field === "object") {
    const keys = Object.keys(field as Record<string, unknown>);
    return `{${keys.slice(0, 3).join(",")}}`;
  }
  return String(field).substring(0, 30);
}

/**
 * Extract currency from raw item
 */
export function extractCurrency(rawItem: Record<string, unknown>): string {
  const currencyPaths: Array<() => unknown> = [
    () => (rawItem.price as Record<string, unknown>)?.currency,
    () => (rawItem.currentPrice as Record<string, unknown>)?.currency,
    () => ((rawItem.sellingStatus as Record<string, unknown>)?.currentPrice as Record<string, unknown>)?.currency,
    () => rawItem.currency,
  ];

  for (const getCurrency of currencyPaths) {
    try {
      const value = getCurrency();
      if (typeof value === "string" && value.length === 3) {
        return value.toUpperCase();
      }
    } catch {
      // Continue
    }
  }

  return "USD";
}

/**
 * Format price for display
 */
export function formatPriceDisplay(priceUsd: number | null, currency = "USD"): string | null {
  if (priceUsd === null || priceUsd <= 0) {
    return null;
  }
  
  return `$${priceUsd.toFixed(2)}`;
}

// ─── INLINE TESTS (run with DEBUG_PRICE_TEST=true) ────────────────────────────
if (Deno.env.get("DEBUG_PRICE_TEST") === "true") {
  console.log("[PRICE_TEST] Running inline price extractor tests...");
  
  const testCases: Array<{ input: Record<string, unknown>; expected: number | null; name: string }> = [
    // eBay Browse API standard
    { input: { price: { value: "219.95", currency: "USD" } }, expected: 219.95, name: "eBay standard" },
    { input: { price: { value: 199.99, currency: "USD" } }, expected: 199.99, name: "eBay numeric" },
    
    // eBay with amount field
    { input: { price: { amount: "1299.00" } }, expected: 1299.00, name: "eBay amount field" },
    
    // eBay currentPrice
    { input: { currentPrice: { value: "549.99" } }, expected: 549.99, name: "eBay currentPrice" },
    
    // eBay sellingStatus nested
    { input: { sellingStatus: { currentPrice: { value: "899.00" } } }, expected: 899.00, name: "eBay sellingStatus" },
    
    // String with currency symbol
    { input: { displayPrice: "$2,199.95" }, expected: 2199.95, name: "Display price with symbol" },
    { input: { displayPrice: "USD 1,500.00" }, expected: 1500.00, name: "Display price with USD prefix" },
    
    // Direct numeric
    { input: { price: 299.99 }, expected: 299.99, name: "Direct numeric price" },
    
    // Direct priceUsd field
    { input: { priceUsd: 449.00 }, expected: 449.00, name: "priceUsd field" },
    { input: { price_usd: 349.00 }, expected: 349.00, name: "price_usd field" },
    
    // Edge cases
    { input: { price: { value: "0" } }, expected: null, name: "Zero price" },
    { input: { price: { value: "" } }, expected: null, name: "Empty string" },
    { input: {}, expected: null, name: "Empty object" },
    { input: { price: null }, expected: null, name: "Null price" },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const tc of testCases) {
    const result = extractPriceUSD(tc.input);
    const ok = result === tc.expected;
    if (ok) {
      passed++;
      console.log(`  ✓ ${tc.name}: ${result}`);
    } else {
      failed++;
      console.error(`  ✗ ${tc.name}: got ${result}, expected ${tc.expected}`);
    }
  }
  
  console.log(`[PRICE_TEST] ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`Price extractor tests failed: ${failed} failures`);
  }
}
