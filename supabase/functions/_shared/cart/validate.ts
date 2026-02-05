/**
 * Cart Validation Module
 * Input validation and URL normalization for cart operations
 */

// Allowed domains for product URLs
export const ALLOWED_DOMAINS = [
  'amazon.com', 'www.amazon.com',
  'ebay.com', 'www.ebay.com',
  'walmart.com', 'www.walmart.com',
  'bestbuy.com', 'www.bestbuy.com',
  'carvana.com', 'www.carvana.com',
  'cargurus.com', 'www.cargurus.com',
  'tesla.com', 'www.tesla.com',
  'edmunds.com', 'www.edmunds.com',
  'target.com', 'www.target.com',
  'homedepot.com', 'www.homedepot.com',
  'shein.com', 'www.shein.com', 'us.shein.com', 'm.shein.com',
  'macys.com', 'www.macys.com', 'm.macys.com',
  'mercari.com', 'www.mercari.com',
  'wayfair.com', 'www.wayfair.com',
];

// Input validation interface
export interface AddCartItemInput {
  productUrl: string;
  productPrice: number;
  quantity: number;
  shippingItemTypeId?: string;
  productTitle?: string;
  productImageUrl?: string;
  deviceId?: string;
  device_id?: string;
  priceEdited?: boolean | string;
  manual_price?: boolean | string;
  price_source?: string;
  priceSource?: string;
  price_confirmation_status?: string;
  priceConfirmationStatus?: string;
  capturedPrice?: number;
  captured_price?: number;
  capturedPriceUsd?: number;
  captured_price_usd?: number;
  proposedPriceUsd?: number;
  proposed_price_usd?: number;
  currency?: string;
}

/**
 * Normalize a product URL to be a valid absolute https URL
 */
export function normalizeProductUrl(val: string): string | null {
  if (!val || typeof val !== 'string') return null;
  let url = val.trim();
  if (!url) return null;
  
  // Add protocol if missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  // Validate URL format
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Normalize an image URL to be a valid absolute https URL
 * Handles protocol-relative (//...) and relative (/...) URLs
 */
export function normalizeImageUrl(raw: unknown, productUrl?: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;

  // Ignore non-web URIs
  if (s.startsWith("data:") || s.startsWith("blob:")) return null;

  // Protocol-relative → https
  if (s.startsWith("//")) {
    s = "https:" + s;
  }

  // Relative path → resolve against product URL origin
  if (s.startsWith("/") || (!s.startsWith("http://") && !s.startsWith("https://"))) {
    if (productUrl) {
      try {
        const base = new URL(productUrl);
        s = new URL(s, base.origin).toString();
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
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Validate add cart item input
 */
export function validateAddCartItemInput(
  body: unknown
): { data: AddCartItemInput; error: null } | { data: null; error: string } {
  if (!body || typeof body !== "object") {
    return { data: null, error: "Invalid request body" };
  }
  
  const b = body as Record<string, unknown>;
  
  // Validate productUrl
  const rawUrl = typeof b.productUrl === "string" ? b.productUrl : "";
  const productUrl = normalizeProductUrl(rawUrl);
  if (!productUrl) {
    return { data: null, error: "Product URL is required and must be valid" };
  }
  
  // Check domain
  try {
    const parsed = new URL(productUrl);
    const isAllowed = ALLOWED_DOMAINS.some(d => parsed.hostname.endsWith(d));
    if (!isAllowed) {
      return { data: null, error: "URL must be from a supported retailer" };
    }
  } catch {
    return { data: null, error: "Invalid URL format" };
  }
  
  // Validate productPrice
  const productPrice = typeof b.productPrice === "number" 
    ? b.productPrice 
    : parseFloat(String(b.productPrice));
  if (isNaN(productPrice) || productPrice <= 0 || productPrice > 1000000) {
    return { data: null, error: "Price must be positive and under 1,000,000" };
  }
  
  // Validate quantity
  let quantity = 1;
  if (b.quantity !== undefined) {
    quantity = typeof b.quantity === "number" 
      ? b.quantity 
      : parseInt(String(b.quantity), 10);
    if (isNaN(quantity) || quantity < 1 || quantity > 100 || !Number.isInteger(quantity)) {
      return { data: null, error: "Quantity must be an integer between 1 and 100" };
    }
  }
  
  // Optional fields
  const shippingItemTypeId = typeof b.shippingItemTypeId === "string" && b.shippingItemTypeId.length === 36 
    ? b.shippingItemTypeId : undefined;
  
  const productTitle = typeof b.productTitle === "string" && b.productTitle.trim() && b.productTitle.length <= 500
    ? b.productTitle.trim() : undefined;
  
  let productImageUrl: string | undefined;
  if (typeof b.productImageUrl === "string" && b.productImageUrl.trim()) {
    try {
      new URL(b.productImageUrl);
      productImageUrl = b.productImageUrl;
    } catch {
      productImageUrl = undefined;
    }
  }
  
  return {
    data: {
      productUrl,
      productPrice,
      quantity,
      shippingItemTypeId,
      productTitle,
      productImageUrl,
      deviceId: typeof b.deviceId === "string" ? b.deviceId : undefined,
      device_id: typeof b.device_id === "string" ? b.device_id : undefined,
      priceEdited: b.priceEdited as boolean | string | undefined,
      manual_price: b.manual_price as boolean | string | undefined,
      price_source: typeof b.price_source === "string" ? b.price_source : undefined,
      priceSource: typeof b.priceSource === "string" ? b.priceSource : undefined,
      price_confirmation_status: typeof b.price_confirmation_status === "string" ? b.price_confirmation_status : undefined,
      priceConfirmationStatus: typeof b.priceConfirmationStatus === "string" ? b.priceConfirmationStatus : undefined,
      capturedPrice: typeof b.capturedPrice === "number" ? b.capturedPrice : undefined,
      captured_price: typeof b.captured_price === "number" ? b.captured_price : undefined,
      capturedPriceUsd: typeof b.capturedPriceUsd === "number" ? b.capturedPriceUsd : undefined,
      captured_price_usd: typeof b.captured_price_usd === "number" ? b.captured_price_usd : undefined,
      proposedPriceUsd: typeof b.proposedPriceUsd === "number" ? b.proposedPriceUsd : undefined,
      proposed_price_usd: typeof b.proposed_price_usd === "number" ? b.proposed_price_usd : undefined,
      currency: typeof b.currency === "string" ? b.currency : undefined,
    },
    error: null,
  };
}

/**
 * Detect if price was user-edited using explicit signals
 */
export function isUserEditedPrice(body: Record<string, unknown>): boolean {
  // Check explicit boolean flags
  const priceEditedFlag = 
    body?.priceEdited === true ||
    String(body?.priceEdited ?? "").toLowerCase() === "true" ||
    body?.manual_price === true ||
    String(body?.manual_price ?? "").toLowerCase() === "true";
  
  // Check price_source
  const priceSource = String(body?.price_source ?? body?.priceSource ?? "").toLowerCase();
  const isManualSource = priceSource === "manual_user" || priceSource === "manual";
  
  // Check if frontend explicitly set price_confirmation_status to 'pending'
  const confirmStatus = String(
    body?.price_confirmation_status ?? body?.priceConfirmationStatus ?? ""
  ).toLowerCase();
  const isPendingFromFrontend = confirmStatus === "pending";
  
  // Check for price difference between proposed and captured
  const capturedPrice = body?.capturedPrice ?? body?.captured_price ?? 
                        body?.capturedPriceUsd ?? body?.captured_price_usd ?? null;
  const productPrice = body?.productPrice ?? body?.price ?? body?.unitPrice ?? null;
  const hasPriceDifference = capturedPrice !== null && productPrice !== null &&
    Math.abs(Number(productPrice) - Number(capturedPrice)) > 0.01;
  
  return priceEditedFlag || isManualSource || isPendingFromFrontend || hasPriceDifference;
}

/**
 * Coalesce image URL from multiple possible field keys
 */
export function coalesceImageUrl(body: Record<string, unknown>): string | null {
  const rawImageUrl = 
    body.productImageUrl ?? 
    body.image_url ?? 
    body.imageUrl ?? 
    body.product_image_url ?? 
    body.thumbnail ??
    body.photo ??
    body.picture ??
    body.productImage ??
    body.image ??
    null;
  
  return typeof rawImageUrl === "string" ? rawImageUrl : null;
}

/**
 * Detect store from product URL
 */
export function detectStore(productUrl: string): string {
  try {
    const urlObj = new URL(productUrl);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();
    
    if (hostname.includes('amazon')) return 'AMAZON';
    if (hostname.includes('ebay')) return 'EBAY';
    if (hostname.includes('walmart')) return 'WALMART';
    if (hostname.includes('bestbuy')) return 'BESTBUY';
    if (hostname.includes('tesla') && pathname.includes('/inventory')) return 'TESLA_USED';
    if (hostname.includes('edmunds')) return 'EDMUNDS';
    if (hostname.includes('carvana')) return 'CARVANA';
    if (hostname.includes('cargurus')) return 'CARGURUS';
    if (hostname.includes('mercari')) return 'MERCARI';
    if (hostname.includes('wayfair')) return 'WAYFAIR';
    return 'OTHER';
  } catch {
    return 'OTHER';
  }
}
