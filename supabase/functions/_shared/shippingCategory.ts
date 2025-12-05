/**
 * Shipping Category Auto-Detection Module
 * 
 * Pure logic utility for determining shipping category from product data.
 * No I/O operations - only string-based keyword matching.
 */

// Category keys matching shipping_item_types table
export type ShippingCategoryKey = 
  | 'clothes_shoes'
  | 'small_electronics'
  | 'laptop_tablet'
  | 'console_medium'
  | 'tv_large_appliance';

export interface CategoryDetectionInput {
  title: string;
  url?: string;
  store?: string;
  existingCategory?: string | null;
}

export interface CategoryDetectionResult {
  category: ShippingCategoryKey | null;
  confidence: number;
  matchedKeywords: string[];
}

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
  ],

  // Small Electronics (0.7 kg) - phones, watches, cameras, earbuds
  'small_electronics': [
    { keywords: ['iphone', 'galaxy s', 'pixel phone', 'smartphone', 'cell phone', 'mobile phone'], weight: 1.5 },
    { keywords: ['airpods', 'earbuds', 'écouteurs', 'buds', 'earpods'], weight: 1.3 },
    { keywords: ['apple watch', 'smartwatch', 'galaxy watch', 'fitbit', 'garmin'], weight: 1.3 },
    { keywords: ['gopro', 'action camera', 'dash cam', 'dashcam', 'webcam'], weight: 1.2 },
    { keywords: ['kindle', 'e-reader', 'ereader'], weight: 1.2 },
    { keywords: ['headphones', 'casque audio', 'earphones', 'beats'], weight: 1.1 },
    { keywords: ['camera', 'caméra', 'canon', 'nikon', 'sony alpha', 'dslr', 'mirrorless'], weight: 1.0 },
    { keywords: ['bluetooth speaker', 'portable speaker', 'jbl', 'bose', 'sonos mini'], weight: 1.0 },
    { keywords: ['drone', 'dji mini', 'mavic mini'], weight: 0.9 },
    { keywords: ['power bank', 'charger', 'chargeur', 'cable', 'câble'], weight: 0.8 },
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
};

// Store-specific category hints
const STORE_CATEGORY_HINTS: Record<string, ShippingCategoryKey[]> = {
  'CARVANA': ['tv_large_appliance'], // Car marketplace - heavy items
  'CARGURUS': ['tv_large_appliance'], // Car marketplace - heavy items
};

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
  // Use word boundary matching for more accuracy
  const regex = new RegExp(`\\b${normalizedKeyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
  return regex.test(text);
}

/**
 * Determine the shipping category from product data
 * 
 * @param input - Product data including title, url, store
 * @returns Category detection result with confidence score
 */
export function determineShippingCategory(input: CategoryDetectionInput): CategoryDetectionResult {
  // If category already exists, respect it
  if (input.existingCategory) {
    return {
      category: input.existingCategory as ShippingCategoryKey,
      confidence: 1.0,
      matchedKeywords: ['existing_category'],
    };
  }

  const title = input.title || '';
  const url = input.url || '';
  const store = input.store || '';

  // Nothing to analyze
  if (!title && !url) {
    return { category: null, confidence: 0, matchedKeywords: [] };
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

  // Apply store-specific hints (boost score if store matches)
  if (store && STORE_CATEGORY_HINTS[store]) {
    for (const hintCategory of STORE_CATEGORY_HINTS[store]) {
      categoryScores[hintCategory].score += 0.5;
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
  if (!bestCategory || bestScore === 0) {
    return { category: null, confidence: 0, matchedKeywords: [] };
  }

  // Base confidence from score magnitude (max out at score of 3)
  const magnitudeConfidence = Math.min(bestScore / 3, 1);
  
  // Margin confidence (how much better is best vs second best)
  const marginConfidence = secondBestScore > 0 
    ? Math.min((bestScore - secondBestScore) / bestScore, 1)
    : 1;

  // Combined confidence: weighted average
  const confidence = Math.round((magnitudeConfidence * 0.6 + marginConfidence * 0.4) * 100) / 100;

  return {
    category: bestCategory,
    confidence: Math.min(confidence, 1),
    matchedKeywords: categoryScores[bestCategory].keywords,
  };
}

/**
 * Get the shipping type ID for a category key by querying the database
 */
export async function getShippingTypeIdForCategory(
  supabase: any,
  categoryKey: ShippingCategoryKey
): Promise<{ id: string; estWeightKg: number; requiresManualQuote: boolean } | null> {
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

// Confidence threshold for auto-applying category
export const AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.8;
