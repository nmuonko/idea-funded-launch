/**
 * Vehicle Payment Guard
 * 
 * Detects vehicle orders and enforces USD currency for MaishaPay payments.
 * Vehicle orders MUST use USD currency (not CDF) to avoid payment gateway errors.
 */

// Vehicle store identifiers
const VEHICLE_STORES = ['CARVANA', 'CARGURUS', 'TESLA_USED', 'EDMUNDS'];

// Vehicle keywords in title/URL
const VEHICLE_KEYWORDS = [
  'car', 'voiture', 'vehicle', 'véhicule', 'auto', 'automobile',
  'toyota', 'honda', 'nissan', 'ford', 'chevrolet', 'bmw', 'mercedes',
  'audi', 'tesla', 'lexus', 'jeep', 'suv', 'pickup', 'truck', 'camion',
  'sedan', 'coupe', 'minivan', 'van', 'motorcycle', 'moto'
];

// Words that should NOT trigger vehicle detection even if they contain vehicle keywords
const VEHICLE_EXCLUSIONS = [
  'car charger', 'car mount', 'car phone', 'car holder', 'car seat cover',
  'car freshener', 'car mat', 'car accessories', 'car cleaning', 'car wash',
  'car vacuum', 'car organizer', 'toy car', 'remote car', 'rc car'
];

// FX rates for currency conversion (manually maintained)
const FX_RATES: Record<string, number> = {
  CDF: 0.0004,   // 1 CDF = 0.0004 USD (1 USD = 2500 CDF)
  EUR: 1.08,    // 1 EUR = 1.08 USD
  GBP: 1.27,    // 1 GBP = 1.27 USD
  ZAR: 0.055,   // 1 ZAR = 0.055 USD
  NGN: 0.0013,  // 1 NGN = 0.0013 USD
  KES: 0.0077,  // 1 KES = 0.0077 USD
  USD: 1.0,     // Base currency
};

// Threshold for high-value orders (for logging purposes only)
export const HIGH_VALUE_USD_THRESHOLD = 1000;

// Error messages for vehicle quote issues
export const VEHICLE_QUOTE_MISSING_ERROR = {
  code: 'VEHICLE_QUOTE_MISSING',
  message_fr: 'Le devis véhicule n\'est pas disponible. Veuillez réessayer.',
  message_en: 'Vehicle quote is not available. Please try again.',
};

export const VEHICLE_CARD_DISABLED_ERROR = {
  code: 'VEHICLE_CARD_DISABLED',
  message_fr: 'Le paiement par carte pour les véhicules est disponible uniquement en USD. Veuillez sélectionner Mobile Money.',
  message_en: 'Card payment for vehicles is available in USD only. Please select Mobile Money.',
};

export const VEHICLE_CARD_NOT_AVAILABLE_ERROR = {
  code: 'VEHICLE_CARD_NOT_AVAILABLE',
  message_fr: 'Pour les véhicules, veuillez payer via Mobile Money (CDF).',
  message_en: 'For vehicles, please pay via Mobile Money (CDF).',
};

export const CHECKOUT_METHOD_MISMATCH_ERROR = {
  code: 'CHECKOUT_METHOD_MISMATCH',
  message_fr: 'Configuration de paiement invalide. Veuillez réessayer.',
  message_en: 'Invalid payment configuration. Please try again.',
};

// Legacy error (kept for backward compatibility)
export const VEHICLE_CURRENCY_ERROR = VEHICLE_CARD_DISABLED_ERROR;

/**
 * Fetch and validate vehicle quotes from database.
 * Returns the total amount from approved quotes (status='SENT').
 */
export async function fetchAndValidateVehicleQuotes(
  supabase: any,
  vehicleItems: any[]
): Promise<{
  valid: boolean;
  totalAmount: number;
  currency: 'USD';
  quoteDetails: Array<{ orderItemId: string; quotedTotal: number; quoteCurrency: string; status: string }>;
  error?: { code: string; message_fr: string; message_en: string };
}> {
  if (!vehicleItems || vehicleItems.length === 0) {
    return {
      valid: true,
      totalAmount: 0,
      currency: 'USD',
      quoteDetails: [],
    };
  }

  const orderItemIds = vehicleItems.map(item => item.id);
  
  // Query quote_requests for these vehicle items
  const { data: quotes, error: quotesError } = await supabase
    .from('quote_requests')
    .select('id, order_item_id, quoted_total_usd, quoted_shipping_usd, status')
    .in('order_item_id', orderItemIds)
    .eq('status', 'SENT'); // Only approved quotes

  if (quotesError) {
    console.error('[fetchAndValidateVehicleQuotes] Error fetching quotes:', quotesError);
    return {
      valid: false,
      totalAmount: 0,
      currency: 'USD',
      quoteDetails: [],
      error: VEHICLE_QUOTE_MISSING_ERROR,
    };
  }

  // Check if all vehicle items have approved quotes
  const quotedItemIds = new Set((quotes || []).map((q: any) => q.order_item_id));
  const missingQuotes = orderItemIds.filter(id => !quotedItemIds.has(id));

  if (missingQuotes.length > 0) {
    console.log('[fetchAndValidateVehicleQuotes] Missing quotes for items:', missingQuotes);
    return {
      valid: false,
      totalAmount: 0,
      currency: 'USD',
      quoteDetails: [],
      error: VEHICLE_QUOTE_MISSING_ERROR,
    };
  }

  // Sum the quoted totals
  let totalAmount = 0;
  const quoteDetails: Array<{ orderItemId: string; quotedTotal: number; quoteCurrency: string; status: string }> = [];

  for (const quote of (quotes || [])) {
    const quotedTotal = Number(quote.quoted_total_usd || 0);
    totalAmount += quotedTotal;
    quoteDetails.push({
      orderItemId: quote.order_item_id,
      quotedTotal,
      quoteCurrency: 'USD', // Quotes are always in USD
      status: quote.status,
    });
  }

  return {
    valid: true,
    totalAmount: round2(totalAmount),
    currency: 'USD',
    quoteDetails,
  };
}

/**
 * Determine the payment currency for MaishaPay based on order value and vehicle status.
 * CRITICAL: Vehicle orders MUST use USD (not CDF) to avoid "devise" errors.
 * Regular high-value orders (non-vehicle) can use CDF.
 */
export function getPaymentCurrencyAndAmount(
  totalUsd: number,
  totalCdf: number,
  isVehicle: boolean,
  exchangeRate: number = 2500
): {
  currency: 'USD' | 'CDF';
  amount: number;
  amountFormatted: string;
  displayAmount: string;
  usedCdf: boolean;
  reason: string;
} {
  // VEHICLE ORDERS: Always use USD (MaishaPay "devise" error fix)
  if (isVehicle) {
    return {
      currency: 'USD',
      amount: round2(totalUsd),
      amountFormatted: totalUsd.toFixed(2),
      displayAmount: `$${totalUsd.toFixed(2)} USD`,
      usedCdf: false,
      reason: 'vehicle_order_usd_enforced',
    };
  }
  
  // High-value NON-vehicle orders: Use CDF to avoid MaishaPay USD limits
  if (totalUsd >= HIGH_VALUE_USD_THRESHOLD) {
    const cdfAmount = totalCdf > 0 ? Math.round(totalCdf) : Math.round(totalUsd * exchangeRate);
    return {
      currency: 'CDF',
      amount: cdfAmount,
      amountFormatted: cdfAmount.toString(),
      displayAmount: `${cdfAmount.toLocaleString('fr-FR')} CDF (≈ $${totalUsd.toFixed(2)} USD)`,
      usedCdf: true,
      reason: `high_value_non_vehicle (>$${HIGH_VALUE_USD_THRESHOLD})`,
    };
  }
  
  // Regular orders under threshold: Use USD
  return {
    currency: 'USD',
    amount: round2(totalUsd),
    amountFormatted: totalUsd.toFixed(2),
    displayAmount: `$${totalUsd.toFixed(2)} USD`,
    usedCdf: false,
    reason: 'regular_order',
  };
}

/**
 * Round to 2 decimal places
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Check if a string contains any vehicle keywords (excluding false positives)
 */
function containsVehicleKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // First check exclusions - if text contains an exclusion phrase, it's NOT a vehicle
  for (const exclusion of VEHICLE_EXCLUSIONS) {
    if (lowerText.includes(exclusion)) {
      return false;
    }
  }
  
  // Then check for vehicle keywords
  for (const keyword of VEHICLE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if URL is from a vehicle marketplace
 */
function isVehicleUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  
  const lowerUrl = url.toLowerCase();
  
  // Tesla inventory URLs
  if (lowerUrl.includes('tesla.com/inventory') || lowerUrl.includes('tesla.com/model')) {
    return true;
  }
  
  // Other vehicle marketplaces
  const vehicleDomains = ['carvana.com', 'cargurus.com', 'autotrader.com', 'cars.com', 'edmunds.com'];
  for (const domain of vehicleDomains) {
    if (lowerUrl.includes(domain)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect if an order contains vehicle items
 */
export function detectVehicleFromItems(items: any[]): { 
  isVehicle: boolean; 
  vehicleItems: any[];
  reasons: string[];
} {
  const vehicleItems: any[] = [];
  const reasons: string[] = [];
  
  for (const item of items) {
    let itemIsVehicle = false;
    const itemReasons: string[] = [];
    
    // Check explicit is_vehicle flag
    if (item.is_vehicle === true) {
      itemIsVehicle = true;
      itemReasons.push('is_vehicle=true');
    }
    
    // Check store type
    const store = (item.store || '').toUpperCase();
    if (VEHICLE_STORES.includes(store)) {
      itemIsVehicle = true;
      itemReasons.push(`store=${store}`);
    }
    
    // Check vehicle_quote_applied flag
    if (item.vehicle_quote_applied === true) {
      itemIsVehicle = true;
      itemReasons.push('vehicle_quote_applied=true');
    }
    
    // Check requires_manual_quote combined with is_vehicle
    if (item.requires_manual_quote === true && item.is_vehicle === true) {
      itemIsVehicle = true;
      itemReasons.push('requires_manual_quote+is_vehicle');
    }
    
    // Check URL for vehicle marketplace
    if (isVehicleUrl(item.product_url)) {
      itemIsVehicle = true;
      itemReasons.push('vehicle_url');
    }
    
    // Check title for vehicle keywords (only if not already flagged)
    if (!itemIsVehicle && containsVehicleKeyword(item.title)) {
      itemIsVehicle = true;
      itemReasons.push('vehicle_keyword_in_title');
    }
    
    // Check for vehicle-specific fields
    if (item.vin || item.mileage || item.year || item.make || item.model) {
      itemIsVehicle = true;
      itemReasons.push('vehicle_fields');
    }
    
    if (itemIsVehicle) {
      vehicleItems.push(item);
      reasons.push(...itemReasons);
    }
  }
  
  return {
    isVehicle: vehicleItems.length > 0,
    vehicleItems,
    reasons: [...new Set(reasons)], // Dedupe reasons
  };
}

/**
 * Get FX rates for currency conversion
 */
export function getFxRates(): Record<string, number> {
  return { ...FX_RATES };
}

/**
 * Normalize currency to USD for vehicle orders
 */
export function normalizeVehicleCurrency(
  originalCurrency: string | null | undefined,
  originalAmount: number,
  fxRates?: Record<string, number>
): { 
  currency: string; 
  amount: number; 
  converted: boolean; 
  error?: string;
  originalCurrency: string;
  originalAmount: number;
} {
  const rates = fxRates || FX_RATES;
  const currency = (originalCurrency || 'USD').toUpperCase().trim();
  
  // If already USD, no conversion needed
  if (currency === 'USD') {
    return {
      currency: 'USD',
      amount: round2(originalAmount),
      converted: false,
      originalCurrency: currency,
      originalAmount,
    };
  }
  
  // Get conversion rate
  const rate = rates[currency];
  
  if (!rate) {
    return {
      currency,
      amount: originalAmount,
      converted: false,
      error: `Unsupported currency: ${currency}`,
      originalCurrency: currency,
      originalAmount,
    };
  }
  
  // Convert to USD
  const usdAmount = round2(originalAmount * rate);
  
  return {
    currency: 'USD',
    amount: usdAmount,
    converted: true,
    originalCurrency: currency,
    originalAmount,
  };
}

/**
 * Load order items and detect vehicles
 */
export async function detectVehicleOrder(
  supabase: any,
  orderId: string
): Promise<{ 
  isVehicle: boolean; 
  vehicleItems: any[];
  reasons: string[];
  error?: string;
}> {
  try {
    const { data: items, error } = await supabase
      .from('order_items')
      .select('id, title, product_url, store, is_vehicle, vehicle_quote_applied, requires_manual_quote')
      .eq('order_id', orderId);
    
    if (error) {
      return { 
        isVehicle: false, 
        vehicleItems: [], 
        reasons: [],
        error: error.message 
      };
    }
    
    if (!items || items.length === 0) {
      return { 
        isVehicle: false, 
        vehicleItems: [], 
        reasons: [],
      };
    }
    
    return detectVehicleFromItems(items);
  } catch (err: any) {
    return { 
      isVehicle: false, 
      vehicleItems: [], 
      reasons: [],
      error: err.message 
    };
  }
}
