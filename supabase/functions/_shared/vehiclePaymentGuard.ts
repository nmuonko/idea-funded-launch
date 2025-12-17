/**
 * Vehicle Payment Guard
 * 
 * Detects vehicle orders and enforces USD currency for MaishaPay payments.
 * Vehicle orders that attempt to use non-USD currencies will be normalized to USD.
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

// Error messages for unsupported currency
export const VEHICLE_CURRENCY_ERROR = {
  code: 'UNSUPPORTED_VEHICLE_CURRENCY',
  message_fr: 'Le paiement par carte pour les véhicules est disponible uniquement en USD. Veuillez sélectionner Mobile Money ou réessayer en USD.',
  message_en: 'Card payments for vehicles are available in USD only. Please select Mobile Money or retry in USD.',
};

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
 * Round to 2 decimal places
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
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
