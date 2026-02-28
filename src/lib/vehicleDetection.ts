/**
 * Client-side vehicle detection for pasted links
 * Lightweight port of server-side shippingCategory logic
 */

const VEHICLE_STORES = [
  'carvana.com', 'cargurus.com', 'autotrader.com', 'cars.com',
  'edmunds.com', 'truecar.com', 'carmax.com', 'vroom.com',
  'tesla.com', 'ford.com', 'chevrolet.com', 'toyota.com',
  'bmwusa.com', 'mbusa.com', 'audi.com',
];

const VEHICLE_URL_PATTERNS = [
  /\/cars\//i, /\/vehicles?\//i, /\/inventory\//i,
  /\/auto\//i, /\/listings?\//i, /\/used-cars/i, /\/new-cars/i,
];

const VEHICLE_TITLE_KEYWORDS = [
  'sedan', 'suv', 'truck', 'pickup', 'coupe', 'convertible',
  'minivan', 'van', 'hatchback', 'wagon', 'crossover',
  'motorcycle', 'motorbike', 'atv', 'utv',
];

// Exclude these — they contain "car" but are accessories
const ACCESSORY_KEYWORDS = [
  'charger', 'mount', 'holder', 'adapter', 'cable', 'case',
  'cover', 'screen protector', 'cleaning', 'freshener', 'mat',
  'organizer', 'phone', 'dash cam', 'dashcam', 'gps',
  'bluetooth', 'speaker', 'vacuum', 'polish', 'wax',
];

export interface VehicleDetectionResult {
  isVehicle: boolean;
  confidence: 'high' | 'low' | 'none';
  reason?: string;
}

export function detectVehicle(url: string, title?: string): VehicleDetectionResult {
  const urlLower = url.toLowerCase();
  const titleLower = (title || '').toLowerCase();

  // 1. Known vehicle store
  for (const store of VEHICLE_STORES) {
    if (urlLower.includes(store)) {
      // Check if it's an accessory on a vehicle site
      if (ACCESSORY_KEYWORDS.some(k => titleLower.includes(k))) {
        return { isVehicle: false, confidence: 'none', reason: 'accessory_on_vehicle_site' };
      }
      return { isVehicle: true, confidence: 'high', reason: `vehicle_store:${store}` };
    }
  }

  // 2. Vehicle URL patterns
  for (const pattern of VEHICLE_URL_PATTERNS) {
    if (pattern.test(urlLower)) {
      if (ACCESSORY_KEYWORDS.some(k => titleLower.includes(k))) {
        return { isVehicle: false, confidence: 'none', reason: 'accessory_url_pattern' };
      }
      return { isVehicle: true, confidence: 'high', reason: `url_pattern:${pattern.source}` };
    }
  }

  // 3. Title keywords (low confidence)
  if (title) {
    // Check accessory exclusions first
    if (ACCESSORY_KEYWORDS.some(k => titleLower.includes(k))) {
      return { isVehicle: false, confidence: 'none' };
    }
    for (const keyword of VEHICLE_TITLE_KEYWORDS) {
      if (titleLower.includes(keyword)) {
        return { isVehicle: true, confidence: 'low', reason: `title_keyword:${keyword}` };
      }
    }
  }

  return { isVehicle: false, confidence: 'none' };
}
