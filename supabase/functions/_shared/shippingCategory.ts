/**
 * Shipping Category Auto-Detection Module
 * 
 * Pure logic utility for determining shipping category from product data.
 * No I/O operations - only string-based keyword matching.
 * 
 * ALWAYS returns a non-null category - uses safe defaults for low-confidence matches.
 */

// Category keys matching shipping_item_types table
export type ShippingCategoryKey = 
  | 'clothes_shoes'
  | 'small_electronics'
  | 'laptop_tablet'
  | 'console_medium'
  | 'tv_large_appliance'
  | 'vehicle'; // Special category - requires manual quote, no automatic pricing

export interface CategoryDetectionInput {
  title: string;
  url?: string;
  store?: string;
  existingCategory?: string | null;
  categoryKey?: string | null; // Authoritative DB category (e.g. 'vehicles', 'vehicles_cars_trucks')
}

export interface CategoryDetectionResult {
  category: ShippingCategoryKey; // ALWAYS non-null
  confidence: number;
  matchedKeywords: string[];
  requiresQuote: boolean; // True for vehicles - no automatic shipping price
  isEstimated: boolean; // True when we used safe default due to low confidence
}

// Safe default category for low-confidence items
// Using console_medium (6 kg) as it won't under-charge shipping
export const SAFE_DEFAULT_CATEGORY: ShippingCategoryKey = 'console_medium';
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

// VEHICLE EXCLUSION KEYWORDS - products containing these are NOT vehicles
// even if they match vehicle brand names (e.g., "Toyota car charger" is NOT a vehicle)
const VEHICLE_EXCLUSION_KEYWORDS = [
  // Car accessories that aren't vehicles
  'charger', 'mount', 'holder', 'organizer', 'seat cover', 'floor mat',
  'phone holder', 'dash cam', 'dashcam', 'car wash', 'car wax', 'car vacuum',
  'air freshener', 'jumper cable', 'car jack', 'tire pump', 'oil change',
  'car cover', 'sunshade', 'sun shade', 'steering wheel cover', 'key fob',
  'remote start', 'car alarm', 'gps tracker', 'obd2', 'obd-ii', 'diagnostic',
  // Heating/cooling products (NOT vehicles)
  'heater', 'heating', 'heated', 'warmer', 'heating pad', 'electric blanket',
  'space heater', 'portable heater', 'fan heater', 'infrared heater',
  // Car parts (not whole vehicles)
  'brake pad', 'brake rotor', 'spark plug', 'oil filter', 'air filter',
  'windshield wiper', 'headlight', 'tail light', 'bumper', 'fender',
  'battery', 'alternator', 'starter motor', 'radiator', 'water pump',
  // Toys and models
  'toy car', 'model car', 'die cast', 'diecast', 'hot wheels', 'matchbox',
  'rc car', 'remote control car', 'toy vehicle', 'lego', 'playset',
  // Electronics with car branding
  'bluetooth', 'fm transmitter', 'aux cable', 'usb adapter', 'car stereo',
  'car speaker', 'subwoofer', 'amplifier', 'backup camera', 'rear camera',
];

// Keyword mappings for each shipping category
// Ordered by specificity - more specific patterns have higher weight
const CATEGORY_KEYWORDS: Record<ShippingCategoryKey, { keywords: string[]; weight: number }[]> = {
  // Clothing / Shoes (0.5 kg)
  'clothes_shoes': [
    { keywords: ['t-shirt', 'tshirt', 'chemise', 'shirt', 'polo'], weight: 1.2 },
    { keywords: ['jeans', 'pantalon', 'pants', 'trousers', 'shorts', 'leggings'], weight: 1.2 },
    { keywords: ['shoe', 'chaussure', 'sneaker', 'basket', 'boots', 'sandal', 'loafer', 'heel'], weight: 1.2 },
    { keywords: ['dress', 'robe', 'skirt', 'jupe'], weight: 1.1 },
    { keywords: ['jacket', 'veste', 'coat', 'manteau', 'hoodie', 'sweatshirt', 'sweater'], weight: 1.1 },
    { keywords: ['underwear', 'socks', 'chaussettes', 'boxers', 'briefs'], weight: 1.0 },
    { keywords: ['hat', 'chapeau', 'cap', 'beanie', 'bonnet'], weight: 1.0 },
    { keywords: ['bag', 'sac', 'backpack', 'purse', 'wallet', 'handbag'], weight: 0.9 },
    { keywords: ['belt', 'ceinture', 'scarf', 'écharpe', 'tie', 'cravate'], weight: 0.9 },
    { keywords: ['clothing', 'vêtement', 'apparel', 'wear', 'fashion'], weight: 0.8 },
    { keywords: ['blouse', 'cardigan', 'blazer', 'vest', 'romper', 'jumpsuit'], weight: 1.0 },
    { keywords: ['lingerie', 'bra', 'panties', 'sleepwear', 'pajama'], weight: 1.0 },
  ],

  // Small Electronics (0.7 kg) - phones, watches, cameras, earbuds
  'small_electronics': [
    { keywords: ['iphone', 'galaxy s', 'pixel phone', 'smartphone', 'cell phone', 'mobile phone', 'unlocked phone'], weight: 1.5 },
    { keywords: ['airpods', 'earbuds', 'écouteurs', 'buds', 'earpods'], weight: 1.3 },
    { keywords: ['apple watch', 'smartwatch', 'galaxy watch', 'fitbit', 'garmin'], weight: 1.3 },
    { keywords: ['gopro', 'action camera', 'dash cam', 'dashcam', 'webcam'], weight: 1.2 },
    { keywords: ['kindle', 'e-reader', 'ereader'], weight: 1.2 },
    { keywords: ['headphones', 'casque audio', 'earphones', 'beats'], weight: 1.1 },
    { keywords: ['camera', 'caméra', 'canon', 'nikon', 'sony alpha', 'dslr', 'mirrorless'], weight: 1.0 },
    { keywords: ['bluetooth speaker', 'portable speaker', 'jbl', 'bose', 'sonos mini'], weight: 1.0 },
    { keywords: ['drone', 'dji mini', 'mavic mini'], weight: 0.9 },
    { keywords: ['power bank', 'charger', 'chargeur', 'cable', 'câble'], weight: 0.8 },
    { keywords: ['mouse', 'keyboard', 'clavier', 'souris'], weight: 0.8 },
  ],

  // Laptop / Tablet (2.5 kg)
  'laptop_tablet': [
    { keywords: ['macbook', 'macbook pro', 'macbook air'], weight: 1.5 },
    { keywords: ['laptop', 'notebook', 'ordinateur portable'], weight: 1.4 },
    { keywords: ['chromebook', 'thinkpad', 'dell xps', 'hp spectre', 'surface laptop'], weight: 1.3 },
    { keywords: ['ipad', 'ipad pro', 'ipad air', 'ipad mini'], weight: 1.3 },
    { keywords: ['tablet', 'tablette', 'galaxy tab', 'fire tablet'], weight: 1.2 },
    { keywords: ['surface pro', 'surface go'], weight: 1.2 },
    { keywords: ['e-ink', 'remarkable'], weight: 1.0 },
  ],

  // Console / Medium Electronics (6 kg)
  'console_medium': [
    { keywords: ['playstation 5', 'ps5', 'playstation5'], weight: 1.5 },
    { keywords: ['playstation 4', 'ps4', 'playstation4'], weight: 1.5 },
    { keywords: ['xbox series x', 'xbox series s', 'xbox one'], weight: 1.5 },
    { keywords: ['nintendo switch', 'switch oled', 'switch lite'], weight: 1.4 },
    { keywords: ['gaming console', 'game console', 'console de jeux'], weight: 1.3 },
    { keywords: ['desktop computer', 'pc tower', 'gaming pc', 'mini pc'], weight: 1.2 },
    { keywords: ['monitor', 'écran', 'computer monitor', 'gaming monitor'], weight: 1.1 },
    { keywords: ['printer', 'imprimante', 'scanner'], weight: 1.0 },
    { keywords: ['router', 'modem', 'wifi router'], weight: 0.9 },
    { keywords: ['soundbar', 'barre de son', 'home theater'], weight: 0.9 },
    { keywords: ['projector', 'projecteur', 'vidéoprojecteur'], weight: 0.9 },
    { keywords: ['vacuum cleaner', 'aspirateur', 'roomba', 'dyson'], weight: 0.8 },
    { keywords: ['air purifier', 'purificateur', 'humidifier'], weight: 0.8 },
    { keywords: ['blender', 'mixer', 'coffee maker', 'toaster', 'air fryer', 'instant pot'], weight: 0.8 },
  ],

  // TV / Large Appliance / Furniture (12 kg) - requires manual quote
  'tv_large_appliance': [
    { keywords: ['television', 'téléviseur', 'smart tv', 'oled tv', 'qled tv', 'led tv'], weight: 1.5 },
    { keywords: ['65 inch', '55 inch', '75 inch', '50 inch', '43 inch', 'inch tv'], weight: 1.4 },
    { keywords: ['refrigerator', 'réfrigérateur', 'fridge', 'freezer', 'congélateur'], weight: 1.5 },
    { keywords: ['washing machine', 'machine à laver', 'washer', 'dryer', 'sèche-linge'], weight: 1.5 },
    { keywords: ['dishwasher', 'lave-vaisselle'], weight: 1.4 },
    { keywords: ['oven', 'four', 'stove', 'cuisinière', 'range', 'microwave'], weight: 1.3 },
    { keywords: ['air conditioner', 'climatiseur', 'ac unit'], weight: 1.3 },
    { keywords: ['sofa', 'canapé', 'couch', 'sectional'], weight: 1.4 },
    { keywords: ['bed', 'lit', 'mattress', 'matelas'], weight: 1.4 },
    { keywords: ['desk', 'bureau', 'table', 'dining table'], weight: 1.2 },
    { keywords: ['chair', 'chaise', 'office chair', 'fauteuil', 'armchair'], weight: 1.1 },
    { keywords: ['bookshelf', 'étagère', 'shelf', 'cabinet', 'armoire', 'dresser'], weight: 1.1 },
    { keywords: ['furniture', 'meuble'], weight: 1.0 },
    { keywords: ['appliance', 'électroménager'], weight: 0.9 },
  ],

  // VEHICLE - Special category requiring manual quote (no automatic shipping price)
  'vehicle': [
    // Generic vehicle terms (high weight)
    { keywords: ['car', 'voiture', 'automobile', 'auto'], weight: 2.0 },
    { keywords: ['suv', 'crossover', 'pickup', 'truck', 'camion'], weight: 2.0 },
    { keywords: ['4x4', '4 x 4', 'four wheel drive', 'awd', 'all wheel drive'], weight: 1.8 },
    { keywords: ['sedan', 'berline', 'hatchback', 'coupe', 'coupé', 'convertible', 'cabriolet'], weight: 1.8 },
    { keywords: ['minivan', 'van', 'fourgon', 'wagon'], weight: 1.8 },
    { keywords: ['motorcycle', 'moto', 'motorbike', 'scooter'], weight: 1.8 },
    
    // Car brands (medium-high weight)
    { keywords: ['toyota', 'camry', 'corolla', 'rav4', 'highlander', 'tacoma', 'tundra'], weight: 1.6 },
    { keywords: ['honda', 'civic', 'accord', 'crv', 'cr-v', 'pilot', 'odyssey'], weight: 1.6 },
    { keywords: ['ford', 'f-150', 'f150', 'mustang', 'explorer', 'escape', 'bronco'], weight: 1.6 },
    { keywords: ['chevrolet', 'chevy', 'silverado', 'tahoe', 'equinox', 'malibu', 'camaro'], weight: 1.6 },
    { keywords: ['nissan', 'altima', 'sentra', 'rogue', 'pathfinder', 'frontier'], weight: 1.6 },
    { keywords: ['jeep', 'wrangler', 'grand cherokee', 'compass', 'gladiator'], weight: 1.6 },
    { keywords: ['tesla', 'model 3', 'model y', 'model s', 'model x', 'cybertruck'], weight: 1.6 },
    { keywords: ['bmw', 'mercedes', 'mercedes-benz', 'benz', 'audi', 'lexus', 'infiniti', 'acura'], weight: 1.5 },
    { keywords: ['volkswagen', 'vw', 'jetta', 'passat', 'tiguan', 'atlas'], weight: 1.5 },
    { keywords: ['hyundai', 'sonata', 'elantra', 'tucson', 'santa fe', 'palisade'], weight: 1.5 },
    { keywords: ['kia', 'sorento', 'sportage', 'telluride', 'forte', 'k5'], weight: 1.5 },
    { keywords: ['subaru', 'outback', 'forester', 'crosstrek', 'impreza', 'wrx'], weight: 1.5 },
    { keywords: ['mazda', 'cx-5', 'cx5', 'cx-9', 'mazda3', 'mazda6', 'mx-5', 'miata'], weight: 1.5 },
    { keywords: ['gmc', 'sierra', 'yukon', 'terrain', 'canyon', 'acadia'], weight: 1.5 },
    { keywords: ['ram', 'ram 1500', 'ram 2500', 'dodge', 'challenger', 'charger', 'durango'], weight: 1.5 },
    { keywords: ['range rover', 'rangerover', 'land rover', 'landrover', 'discovery', 'defender'], weight: 1.5 },
    { keywords: ['land cruiser', 'landcruiser', 'prado', '4runner'], weight: 1.5 },
    { keywords: ['porsche', 'cayenne', '911', 'macan', 'panamera'], weight: 1.5 },
    { keywords: ['volvo', 'xc90', 'xc60', 'xc40', 's60', 'v60'], weight: 1.5 },
    { keywords: ['buick', 'cadillac', 'escalade', 'cts', 'xt5'], weight: 1.4 },
    { keywords: ['lincoln', 'navigator', 'aviator', 'corsair'], weight: 1.4 },
    
    // Vehicle-related terms
    { keywords: ['used car', 'pre-owned', 'certified pre-owned', 'cpo'], weight: 1.8 },
    { keywords: ['mileage', 'miles', 'odometer', 'km', 'kilométrage'], weight: 1.2 },
    { keywords: ['vin', 'vehicle identification'], weight: 1.5 },
  ],
};

// Store-specific category hints - strong signals based on store type
// All car marketplaces (active and deprecated) map to 'vehicle'
const STORE_CATEGORY_HINTS: Record<string, ShippingCategoryKey> = {
  // NEW: Active car marketplaces
  'TESLA_USED': 'vehicle', // Tesla used inventory - always vehicles
  'EDMUNDS': 'vehicle',    // Edmunds car listings - always vehicles
  // DEPRECATED: Old car marketplaces (kept for historical data)
  'CARVANA': 'vehicle',    // Car marketplace - always vehicles
  'CARGURUS': 'vehicle',   // Car marketplace - always vehicles
};

// Store-specific default categories (when no other match found)
const STORE_DEFAULT_CATEGORIES: Record<string, ShippingCategoryKey> = {
  'SHEIN': 'clothes_shoes',     // SHEIN is fashion-focused
  'TARGET': 'console_medium',   // General retailer
  'WALMART': 'console_medium',  // General retailer
  'AMAZON': 'console_medium',   // General retailer
  'EBAY': 'console_medium',     // General marketplace
  'BESTBUY': 'small_electronics', // Electronics retailer
  'HOMEDEPOT': 'console_medium',  // Home improvement
  'MERCARI': 'console_medium',    // Used goods marketplace
  'WAYFAIR': 'tv_large_appliance', // Home/Furniture retailer
};

// URL path patterns that strongly indicate vehicles
const VEHICLE_URL_PATTERNS = [
  '/cars',
  '/vehicles',
  '/autos',
  '/inventory',
  '/vdp/', // Vehicle detail page
  '/buy/',
  '/used-cars',
  '/new-cars',
  '/certified-used',
];

// URL path patterns for store category detection
const URL_CATEGORY_PATTERNS: { pattern: string; category: ShippingCategoryKey; weight: number }[] = [
  // Amazon categories
  { pattern: '/electronics/', category: 'small_electronics', weight: 1.5 },
  { pattern: '/computers-tablets/', category: 'laptop_tablet', weight: 1.5 },
  { pattern: '/computers/', category: 'laptop_tablet', weight: 1.4 },
  { pattern: '/clothing/', category: 'clothes_shoes', weight: 1.5 },
  { pattern: '/fashion/', category: 'clothes_shoes', weight: 1.4 },
  { pattern: '/shoes/', category: 'clothes_shoes', weight: 1.5 },
  { pattern: '/home/', category: 'console_medium', weight: 1.0 },
  { pattern: '/appliances/', category: 'tv_large_appliance', weight: 1.3 },
  { pattern: '/tv-video/', category: 'tv_large_appliance', weight: 1.4 },
  { pattern: '/video-games/', category: 'console_medium', weight: 1.3 },
  { pattern: '/cell-phones/', category: 'small_electronics', weight: 1.4 },
  { pattern: '/sports/', category: 'console_medium', weight: 1.0 },
  { pattern: '/toys/', category: 'small_electronics', weight: 0.9 },
  { pattern: '/beauty/', category: 'small_electronics', weight: 0.8 },
  { pattern: '/jewelry/', category: 'small_electronics', weight: 1.0 },
  { pattern: '/watches/', category: 'small_electronics', weight: 1.2 },
  { pattern: '/bags/', category: 'clothes_shoes', weight: 1.2 },
  { pattern: '/luggage/', category: 'console_medium', weight: 1.1 },
  
  // eBay categories
  { pattern: '/b/cell-phones', category: 'small_electronics', weight: 1.4 },
  { pattern: '/b/computers', category: 'laptop_tablet', weight: 1.4 },
  { pattern: '/b/clothing', category: 'clothes_shoes', weight: 1.4 },
  { pattern: '/b/shoes', category: 'clothes_shoes', weight: 1.4 },
  { pattern: '/b/consumer-electronics', category: 'small_electronics', weight: 1.3 },
  { pattern: '/b/video-games', category: 'console_medium', weight: 1.3 },
  
  // BestBuy categories
  { pattern: '/site/computers', category: 'laptop_tablet', weight: 1.5 },
  { pattern: '/site/cell-phones', category: 'small_electronics', weight: 1.5 },
  { pattern: '/site/tv-home-theater', category: 'tv_large_appliance', weight: 1.5 },
  { pattern: '/site/appliances', category: 'tv_large_appliance', weight: 1.5 },
  { pattern: '/site/video-games', category: 'console_medium', weight: 1.4 },
  { pattern: '/site/headphones', category: 'small_electronics', weight: 1.3 },
  { pattern: '/site/cameras', category: 'small_electronics', weight: 1.3 },
  
  // Walmart categories  
  { pattern: '/cp/electronics', category: 'small_electronics', weight: 1.4 },
  { pattern: '/cp/clothing', category: 'clothes_shoes', weight: 1.4 },
  { pattern: '/cp/home', category: 'console_medium', weight: 1.0 },
  { pattern: '/cp/appliances', category: 'tv_large_appliance', weight: 1.3 },
  { pattern: '/ip/', category: 'console_medium', weight: 0.5 }, // Product page, low weight
  
  // Target categories
  { pattern: '/c/electronics', category: 'small_electronics', weight: 1.4 },
  { pattern: '/c/clothing', category: 'clothes_shoes', weight: 1.4 },
  { pattern: '/c/home', category: 'console_medium', weight: 1.0 },
  
  // SHEIN categories (always clothing-related)
  { pattern: '/category/', category: 'clothes_shoes', weight: 1.3 },
  { pattern: '/women/', category: 'clothes_shoes', weight: 1.4 },
  { pattern: '/men/', category: 'clothes_shoes', weight: 1.4 },
  { pattern: '/kids/', category: 'clothes_shoes', weight: 1.4 },
  { pattern: '/shoes/', category: 'clothes_shoes', weight: 1.5 },
  { pattern: '/bags/', category: 'clothes_shoes', weight: 1.3 },
  { pattern: '/jewelry/', category: 'small_electronics', weight: 1.0 },
  
  // Home Depot categories
  { pattern: '/p/', category: 'console_medium', weight: 0.5 }, // Product page
  { pattern: '/b/appliances', category: 'tv_large_appliance', weight: 1.4 },
  { pattern: '/b/furniture', category: 'tv_large_appliance', weight: 1.3 },
  { pattern: '/b/tools', category: 'console_medium', weight: 1.2 },
  { pattern: '/b/lighting', category: 'small_electronics', weight: 1.0 },
];

/**
 * Normalize text for keyword matching
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s]/g, ' ')    // Replace special chars with space
    .replace(/\s+/g, ' ')            // Collapse multiple spaces
    .trim();
}

/**
 * Check if a keyword exists in the text
 */
function containsKeyword(text: string, keyword: string): boolean {
  const normalizedKeyword = normalizeText(keyword);
  // Use word-start boundary matching — allow keyword to be a prefix of longer words
  // e.g. "galaxy s" should match "galaxy s21", "galaxy s24 ultra", etc.
  const regex = new RegExp(`\\b${normalizedKeyword.replace(/\s+/g, '\\s+')}`, 'i');
  return regex.test(text);
}

/**
 * Check if URL contains vehicle-related patterns
 */
function hasVehicleUrlPattern(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return VEHICLE_URL_PATTERNS.some(pattern => lowerUrl.includes(pattern));
}

/**
 * Extract category hints from URL path
 */
function getCategoryFromUrl(url: string): { category: ShippingCategoryKey; weight: number } | null {
  const lowerUrl = url.toLowerCase();
  
  for (const { pattern, category, weight } of URL_CATEGORY_PATTERNS) {
    if (lowerUrl.includes(pattern)) {
      return { category, weight };
    }
  }
  
  return null;
}

/**
 * Determine the shipping category from product data
 * 
 * ALWAYS returns a non-null category. Uses safe defaults for low-confidence matches.
 * 
 * @param input - Product data including title, url, store
 * @returns Category detection result with confidence score and requiresQuote flag
 */
export function determineShippingCategory(input: CategoryDetectionInput): CategoryDetectionResult {
  // DEFINITIVE: If DB categoryKey says it's a vehicle, trust it completely
  if (input.categoryKey?.startsWith('vehicle')) {
    return {
      category: 'vehicle',
      confidence: 1.0,
      matchedKeywords: ['db_category_key'],
      requiresQuote: true,
      isEstimated: false,
    };
  }

  // If category already exists, respect it
  if (input.existingCategory) {
    const isVehicle = input.existingCategory === 'vehicle';
    return {
      category: input.existingCategory as ShippingCategoryKey,
      confidence: 1.0,
      matchedKeywords: ['existing_category'],
      requiresQuote: isVehicle,
      isEstimated: false,
    };
  }

  const title = input.title || '';
  const url = input.url || '';
  const store = (input.store || '').toUpperCase();
  const normalizedTitle = normalizeText(title);

  // CRITICAL: Check for vehicle exclusion keywords FIRST
  // If ANY exclusion keyword is found, this item is definitely NOT a vehicle
  const hasVehicleExclusion = VEHICLE_EXCLUSION_KEYWORDS.some(keyword => 
    containsKeyword(normalizedTitle, keyword)
  );

  if (hasVehicleExclusion) {
    console.log('[shippingCategory] Vehicle exclusion detected:', { 
      titlePrefix: title.substring(0, 60), 
      store,
      reason: 'exclusion_keyword_match'
    });
  }

  // Check for store-specific strong hints first (car marketplaces)
  // ONLY apply vehicle category for car marketplace stores (CARVANA, CARGURUS)
  // AND only if no exclusion keyword was found
  if (store && STORE_CATEGORY_HINTS[store] && !hasVehicleExclusion) {
    const category = STORE_CATEGORY_HINTS[store];
    const isVehicle = category === 'vehicle';
    return {
      category,
      confidence: 1.0,
      matchedKeywords: ['store_hint_' + store.toLowerCase()],
      requiresQuote: isVehicle,
      isEstimated: false,
    };
  }

  // Combine title and URL path for analysis
  let urlPath = '';
  try {
    const parsedUrl = new URL(url);
    urlPath = parsedUrl.pathname + ' ' + parsedUrl.search;
  } catch {
    // Invalid URL, continue with title only
  }

  const combinedText = normalizeText(`${title} ${urlPath}`);
  
  // Score each category
  const categoryScores: Record<ShippingCategoryKey, { score: number; keywords: string[] }> = {
    'clothes_shoes': { score: 0, keywords: [] },
    'small_electronics': { score: 0, keywords: [] },
    'laptop_tablet': { score: 0, keywords: [] },
    'console_medium': { score: 0, keywords: [] },
    'tv_large_appliance': { score: 0, keywords: [] },
    'vehicle': { score: 0, keywords: [] },
  };

  // Check each category's keywords
  for (const [category, keywordGroups] of Object.entries(CATEGORY_KEYWORDS)) {
    const cat = category as ShippingCategoryKey;
    
    for (const group of keywordGroups) {
      for (const keyword of group.keywords) {
        if (containsKeyword(combinedText, keyword)) {
          categoryScores[cat].score += group.weight;
          categoryScores[cat].keywords.push(keyword);
        }
      }
    }
  }

  // Apply URL pattern hints
  if (url) {
    const urlHint = getCategoryFromUrl(url);
    if (urlHint) {
      categoryScores[urlHint.category].score += urlHint.weight;
      categoryScores[urlHint.category].keywords.push('url_category_hint');
    }
    
    // Apply URL pattern boost for vehicles
    if (hasVehicleUrlPattern(url)) {
      categoryScores['vehicle'].score += 1.5;
      categoryScores['vehicle'].keywords.push('url_vehicle_pattern');
    }
  }

  // Find the best category
  let bestCategory: ShippingCategoryKey | null = null;
  let bestScore = 0;
  let secondBestScore = 0;

  for (const [category, data] of Object.entries(categoryScores)) {
    if (data.score > bestScore) {
      secondBestScore = bestScore;
      bestScore = data.score;
      bestCategory = category as ShippingCategoryKey;
    } else if (data.score > secondBestScore) {
      secondBestScore = data.score;
    }
  }

  // Calculate confidence based on:
  // 1. Absolute score (more matches = higher confidence)
  // 2. Score margin (bigger gap from second best = higher confidence)
  
  // Base confidence from score magnitude (max out at score of 3)
  const magnitudeConfidence = bestScore > 0 ? Math.min(bestScore / 3, 1) : 0;
  
  // Margin confidence (how much better is best vs second best)
  const marginConfidence = (bestScore > 0 && secondBestScore > 0)
    ? Math.min((bestScore - secondBestScore) / bestScore, 1)
    : (bestScore > 0 ? 1 : 0);

  // Combined confidence: weighted average
  const confidence = Math.round((magnitudeConfidence * 0.6 + marginConfidence * 0.4) * 100) / 100;

  // ALWAYS return a category - use fallbacks if no strong match
  let finalCategory: ShippingCategoryKey;
  let isEstimated = false;
  let matchedKeywords: string[] = [];

  if (bestCategory && bestScore > 0) {
    finalCategory = bestCategory;
    matchedKeywords = categoryScores[bestCategory].keywords;
    
    // Mark as estimated if confidence is low
    if (confidence < LOW_CONFIDENCE_THRESHOLD && bestCategory !== 'vehicle') {
      isEstimated = true;
    }
  } else {
    // No keyword matches - use store default or safe default
    if (store && STORE_DEFAULT_CATEGORIES[store]) {
      finalCategory = STORE_DEFAULT_CATEGORIES[store];
      matchedKeywords = ['store_default_' + store.toLowerCase()];
      isEstimated = true;
    } else {
      finalCategory = SAFE_DEFAULT_CATEGORY;
      matchedKeywords = ['safe_default'];
      isEstimated = true;
    }
  }

  // Log ambiguous/estimated cases for improvement
  if (isEstimated) {
    console.log('[shippingCategory] Estimated category (low confidence):', {
      titlePrefix: title.substring(0, 60),
      store,
      chosenCategory: finalCategory,
      confidence,
      matchedKeywords: matchedKeywords.slice(0, 5),
    });
  }

  // Determine if this requires a manual quote
  // Vehicles require a quote, but ONLY if confidence is strong enough.
  // Items that merely mention a car brand (e.g. "Honda Generator") should NOT
  // be flagged as vehicles. We require either:
  //   - A car-marketplace store hint (CARVANA, CARGURUS, etc.) — already handled above
  //   - A vehicle URL pattern AND keyword match
  //   - Strong keyword-only match (score >= 3.0) indicating multiple vehicle signals
  const isVehicle = finalCategory === 'vehicle';
  const hasStrongVehicleSignal = bestScore >= 3.0 || 
    (categoryScores['vehicle'].keywords.includes('url_vehicle_pattern') && bestScore >= 1.5);
  const requiresQuote = isVehicle && !hasVehicleExclusion && hasStrongVehicleSignal;

  return {
    category: finalCategory,
    confidence: Math.min(confidence, 1),
    matchedKeywords,
    requiresQuote,
    isEstimated,
  };
}

/**
 * Get the shipping type ID for a category key by querying the database
 * Returns null for vehicles (they don't use standard shipping types)
 */
export async function getShippingTypeIdForCategory(
  supabase: any,
  categoryKey: ShippingCategoryKey
): Promise<{ id: string; estWeightKg: number; requiresManualQuote: boolean } | null> {
  // Vehicles don't have a standard shipping type
  if (categoryKey === 'vehicle') {
    return null;
  }

  const { data, error } = await supabase
    .from('shipping_item_types')
    .select('id, est_weight_kg, requires_manual_quote')
    .eq('key', categoryKey)
    .eq('active', true)
    .single();

  if (error || !data) {
    console.error('[shippingCategory] Failed to find shipping type for key:', categoryKey, error);
    return null;
  }

  return {
    id: data.id,
    estWeightKg: data.est_weight_kg,
    requiresManualQuote: data.requires_manual_quote,
  };
}

// Confidence threshold for auto-applying standard categories
export const AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.8;

// Lower threshold for vehicle detection (we want to catch vehicles even with less certainty)
export const VEHICLE_QUOTE_CONFIDENCE_THRESHOLD = 0.7;

/**
 * PROMPT 4: Normalize category to slug-safe format
 * Converts display names or raw keys to normalized slugs:
 * - "Affordable Deals" → "affordable_deals"
 * - "Home & Furniture" → "home_furniture"
 * - "browse.affordable deals" → "affordable_deals"
 * - "Used & Cheap" → "used_cheap"
 */
export function normalizeCategorySlug(category: string | null | undefined): string | null {
  if (!category) return null;
  
  // Remove i18n prefixes like "browse."
  let slug = category.replace(/^browse\./i, '');
  
  // Convert to lowercase
  slug = slug.toLowerCase();
  
  // Replace & with empty (e.g., "home & furniture" → "home furniture")
  slug = slug.replace(/&/g, '');
  
  // Replace spaces and multiple underscores with single underscore
  slug = slug.replace(/\s+/g, '_').replace(/_+/g, '_');
  
  // Remove leading/trailing underscores
  slug = slug.replace(/^_+|_+$/g, '');
  
  return slug || null;
}

/**
 * Get human-readable label for a category slug
 */
export function getCategoryLabel(slug: string | null | undefined): string {
  if (!slug) return 'Other';
  
  const labels: Record<string, string> = {
    'clothes_shoes': 'Clothing & Shoes',
    'small_electronics': 'Small Electronics',
    'laptop_tablet': 'Laptops & Tablets',
    'console_medium': 'Medium Items',
    'tv_large_appliance': 'Large Appliances',
    'vehicle': 'Vehicle',
    'affordable_deals': 'Affordable Deals',
    'home_furniture': 'Home & Furniture',
    'used_cheap': 'Used & Cheap',
  };
  
  return labels[slug] || slug.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
