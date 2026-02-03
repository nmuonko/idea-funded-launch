/**
 * Query Canonicalization Module
 * Corrects common typos and variations to improve cache hit rate
 * 
 * "iphon 15" → "iphone 15" (cache hit!)
 * "tesle model 3" → "tesla model 3" (cache hit!)
 */

// Popular product terms with common misspellings
// Each canonical term maps to an array of typos
const CANONICAL_TERMS: Record<string, string[]> = {
  // Phones & Mobile
  "iphone": ["iphon", "iphonne", "ipone", "ifonee", "ifone", "iphn", "iphne", "iphome", "ihpone"],
  "samsung": ["samsun", "sumsung", "samung", "samsumg", "samsug", "smasung", "samson"],
  "galaxy": ["galxy", "galaxi", "gallaxy", "glaxy", "galaxxy"],
  "airpods": ["airpod", "airpds", "airpood", "earpods", "airppods", "airpos"],
  "pixel": ["pixle", "pxiel", "pixl"],
  "huawei": ["huwaei", "hauwei", "huawai", "hawei", "huwei"],
  "xiaomi": ["xiomi", "xaomi", "xiaom", "xiami", "xioami"],
  "tecno": ["techno", "tekno", "tecn"],
  // IMPORTANT: "infinix" typos should NOT include "infiniti"-like typos
  // "infiniti" is a vehicle brand and must be protected (see vehicle brands section below)
  "infinix": ["infiniix", "infiniks", "infinx"], // NOT "infnix" - too close to "infiniti"
  "realme": ["relme", "reame", "realmi"],
  "oneplus": ["one plus", "onplus", "onepls"],
  "motorola": ["motorla", "motorolla", "moto"],
  
  // Computers & Laptops
  "macbook": ["mackbook", "macbok", "mcbook", "macbuk", "makbook", "macboo"],
  "laptop": ["laptob", "labtop", "laptoop", "loptop"],
  "lenovo": ["lenove", "lennovo", "lenvo", "lnovo"],
  "thinkpad": ["thinkpd", "thnikpad", "thikpad"],
  "chromebook": ["chrombok", "cromebook", "chromebok"],
  "monitor": ["moniter", "monitr", "montor"],
  "keyboard": ["keybord", "keybaord", "keybard"],
  
  // Gaming
  "playstation": ["playstaion", "playstaton", "pleystation", "playstatn", "playstion"],
  "xbox": ["xbx", "xbok", "xboks"],
  "nintendo": ["nintedo", "nitendo", "nentendo", "nintindo"],
  "controller": ["controler", "controll", "controlle", "controlr"],
  "console": ["consol", "consle", "conole"],
  
  // Vehicles (for Amazon Autos integration)
  "toyota": ["toyata", "toyoto", "toyta", "tayota", "toyot"],
  "honda": ["hond", "hunda", "hnoda", "honada"],
  "tesla": ["tesle", "tsla", "telsa", "tesela", "teslla"],
  "ford": ["frod", "fodr"],
  "chevrolet": ["chevorlet", "chevrolete", "chevolet", "chevrollet"],
  "chevy": [], // Keep chevy as-is, don't map to chevrolet
  "bmw": ["bwm", "bm"],
  "mercedes": ["mercedez", "merceds", "merceedes", "mercedees"],
  "hyundai": ["hundai", "hyundia", "hyunda", "hundayi", "hyudai"],
  "nissan": ["nisan", "nisaan", "nisson"],
  "volkswagen": ["volswagen", "volkswagon", "volkwagen", "volkswagn"],
  "audi": ["audie", "audo"],
  "lexus": ["lexis", "lexux", "laxus"],
  "mazda": ["mazada", "mazzda", "mazd"],
  "subaru": ["subaroo", "subaro", "suburu"],
  "jeep": ["jep", "jeap", "jeeep"],
  "dodge": ["doge", "dodg", "dooge"],
  "chrysler": ["crysler", "chryslr", "chrsyler"],
  "cadillac": ["cadilac", "cadilack", "cadilak"],
  "porsche": ["porshe", "porsh", "porcshe", "porscha"],
  "ferrari": ["ferari", "ferrri", "ferarri"],
  "lamborghini": ["lambo", "lamborgini", "lamborghni", "lamborghin"],
  // IMPORTANT: Vehicle brands that should NOT be confused with phone brands
  // CRITICAL: "infiniti" MUST NOT be canonicalized to "infinix" (phone brand)
  // These are protected vehicle brand names that should never be typo-corrected to phone brands
  "infiniti": ["infinti", "infinty", "inifiniti", "infintii", "infniti", "infinitie"], // Luxury vehicle brand - NOT infinix (phone)
  "acura": ["accura", "acurra", "acur"],
  "genesis": ["genisis", "gensis", "genesi"],
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PROTECTED VEHICLE TERMS: Prevent fuzzy matching to electronics
  // These terms have empty arrays - they exist only to block fuzzy matches
  // e.g., "rover" must NOT fuzzy-match to "router" (Levenshtein distance 2)
  // ═══════════════════════════════════════════════════════════════════════════
  "rover": [],        // Prevent "rover" → "router"
  "cherokee": [],     // Prevent unwanted fuzzy matches
  "silverado": [],    // Prevent unwanted fuzzy matches
  "escalade": [],     // Prevent unwanted fuzzy matches
  "bronco": [],       // Prevent unwanted fuzzy matches
  "mustang": [],      // Prevent unwanted fuzzy matches
  "corvette": [],     // Prevent unwanted fuzzy matches
  "camaro": [],       // Prevent unwanted fuzzy matches
  "challenger": [],   // Prevent unwanted fuzzy matches (Dodge Challenger)
  // Note: "charger" is in General Products section for battery chargers
  "navigator": [],    // Prevent unwanted fuzzy matches
  "tahoe": [],        // Prevent unwanted fuzzy matches
  "suburban": [],     // Prevent unwanted fuzzy matches
  "wrangler": [],     // Prevent unwanted fuzzy matches
  "gladiator": [],    // Prevent unwanted fuzzy matches
  "prius": [],        // Prevent unwanted fuzzy matches
  "miata": [],        // Prevent unwanted fuzzy matches
  
  // Toyota models - prevent "camry" → "camaro" fuzzy match
  "camry": [],        // CRITICAL: Prevent "camry" → "camaro"
  "corolla": [],      // Prevent unwanted fuzzy matches
  "rav4": [],         // Prevent unwanted fuzzy matches
  "highlander": [],   // Prevent unwanted fuzzy matches
  "tacoma": [],       // Prevent unwanted fuzzy matches
  "tundra": [],       // Prevent unwanted fuzzy matches
  "sienna": [],       // Prevent unwanted fuzzy matches
  "4runner": [],      // Prevent unwanted fuzzy matches
  "avalon": [],       // Prevent unwanted fuzzy matches
  "supra": [],        // Prevent unwanted fuzzy matches
  
  // Honda models
  "civic": [],        // Prevent unwanted fuzzy matches
  "accord": [],       // Prevent unwanted fuzzy matches
  "pilot": [],        // Prevent unwanted fuzzy matches
  "odyssey": [],      // Prevent unwanted fuzzy matches
  "crv": [],          // Prevent unwanted fuzzy matches
  "hrv": [],          // Prevent unwanted fuzzy matches
  
  // Nissan models
  "altima": [],       // Prevent unwanted fuzzy matches
  "sentra": [],       // Prevent unwanted fuzzy matches
  "rogue": [],        // Prevent unwanted fuzzy matches
  "pathfinder": [],   // Prevent unwanted fuzzy matches
  "frontier": [],     // Prevent unwanted fuzzy matches
  "maxima": [],       // Prevent unwanted fuzzy matches
  "murano": [],       // Prevent unwanted fuzzy matches
  "patrol": [],       // Prevent unwanted fuzzy matches
  
  // Hyundai/Kia models
  "elantra": [],      // Prevent unwanted fuzzy matches
  "sonata": [],       // Prevent unwanted fuzzy matches
  "tucson": [],       // Prevent unwanted fuzzy matches
  "sportage": [],     // Prevent unwanted fuzzy matches
  "telluride": [],    // Prevent unwanted fuzzy matches
  "sorento": [],      // Prevent unwanted fuzzy matches
  "optima": [],       // Prevent unwanted fuzzy matches
  "stinger": [],      // Prevent unwanted fuzzy matches
  
  // BMW/Mercedes/Audi models
  "x5": [],           // Prevent unwanted fuzzy matches
  "x3": [],           // Prevent unwanted fuzzy matches
  "x7": [],           // Prevent unwanted fuzzy matches
  "q5": [],           // Prevent unwanted fuzzy matches
  "q7": [],           // Prevent unwanted fuzzy matches
  "gle": [],          // Prevent unwanted fuzzy matches
  "glc": [],          // Prevent unwanted fuzzy matches
  
  // Range Rover / Land Rover (commonly searched vehicle names)
  "range rover": ["rangerover", "range rove", "rang rover", "rnage rover", "range rver"],
  "land rover": ["landrover", "land rove", "lanr rover", "lnad rover"],
  // Ford trucks
  "f-150": ["f150", "f 150"],
  "f-250": ["f250", "f 250"],
  "f-350": ["f350", "f 350"],
  // Jeep models
  "grand cherokee": ["grandcherokee", "grand cheroki", "grand cheroke"],
  // Tesla models
  "cybertruck": ["cyber truck", "cybertruk", "cybertuck"],
  
  // Electronics
  "television": ["televisn", "televison", "televsion", "tv"],
  "headphones": ["headphone", "headphons", "hedphones", "headfones"],
  "bluetooth": ["bluethooth", "blutooth", "bluetoth", "bluetooh"],
  "speaker": ["speakr", "speeker", "speker", "speakrs"],
  "camera": ["camra", "camara", "cammera", "camrea"],
  "printer": ["printr", "prnter", "printe", "printor"],
  "router": ["routr", "roter", "ruoter"],
  "tablet": ["tablt", "tabet", "tablat"],
  "smartwatch": ["smart watch", "smartwach", "smatwatch"],
  
  // Fashion & Brands
  "adidas": ["addidas", "adidass", "adiddas", "addidas"],
  "nike": ["nkie", "niike", "nke"],
  "puma": ["pume", "pumma"],
  "gucci": ["guccci", "guci", "guchi"],
  "supreme": ["suprme", "suprem", "surpreme"],
  "balenciaga": ["balenciage", "balenciga", "balenciag"],
  "versace": ["versache", "versac", "versase"],
  
  // Home & Kitchen
  "refrigerator": ["refridgerator", "refridgrator", "fridge", "refigerator"],
  "microwave": ["mircowave", "micorwave", "microave", "microwav"],
  "dishwasher": ["dishwashr", "dishwashe", "diswasher"],
  "furniture": ["furnitur", "furnture", "furnitue"],
  "mattress": ["matress", "mattres", "matress"],
  
  // General Products
  "wireless": ["wirless", "wirelss", "wireles", "wierless"],
  "charger": ["chargr", "chargar", "charger", "chager"],
  "adapter": ["adaptor", "adaptrer", "adaptar"],
  "battery": ["baterry", "batery", "battry", "batteri"],
  "accessories": ["accessory", "accesories", "accessoris", "acessories"],
};

// Build reverse lookup map for O(1) typo detection
const TYPO_TO_CANONICAL: Map<string, string> = new Map();
for (const [canonical, typos] of Object.entries(CANONICAL_TERMS)) {
  for (const typo of typos) {
    TYPO_TO_CANONICAL.set(typo, canonical);
  }
  // Also map canonical to itself for consistency
  TYPO_TO_CANONICAL.set(canonical, canonical);
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching unknown terms
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Try to fuzzy match a token against known canonical terms
 * Only used when direct lookup fails
 */
function fuzzyMatch(token: string, threshold: number = 2): string | null {
  // Skip short tokens (too many false positives)
  if (token.length < 4) return null;
  
  // Skip pure numbers
  if (/^\d+$/.test(token)) return null;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // VEHICLE TOKEN PROTECTION: Skip fuzzy matching for vehicle model identifiers
  // These patterns are common in vehicle models (qx80, f-150, x5, c300, 4runner)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Skip tokens containing ANY digit (qx80, c300, a4, 4runner, cx5, 530i, etc.)
  // This prevents vehicle model identifiers from being corrupted by fuzzy matching
  if (/\d/.test(token)) {
    console.log(`[CANONICALIZER] Skipping fuzzy match for digit-token: "${token}"`);
    return null;
  }
  
  // Skip tokens containing hyphens (f-150, cr-v, cx-5, e-tron, etc.)
  // Vehicle models frequently use hyphens in their identifiers
  if (token.includes("-")) {
    console.log(`[CANONICALIZER] Skipping fuzzy match for hyphen-token: "${token}"`);
    return null;
  }
  
  let bestMatch: string | null = null;
  let bestDistance = threshold + 1;
  
  for (const canonical of Object.keys(CANONICAL_TERMS)) {
    // Skip if lengths differ too much
    if (Math.abs(token.length - canonical.length) > threshold) continue;
    
    const distance = levenshteinDistance(token, canonical);
    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = canonical;
    }
  }
  
  return bestMatch;
}

/**
 * Canonicalize a single token
 */
function canonicalizeToken(token: string): string {
  // Direct lookup first (O(1))
  const direct = TYPO_TO_CANONICAL.get(token);
  if (direct) return direct;
  
  // Fuzzy match for longer tokens
  const fuzzy = fuzzyMatch(token);
  if (fuzzy) return fuzzy;
  
  // No match, return original
  return token;
}

/**
 * Canonicalize a normalized query string
 * Corrects common typos to improve cache hit rate
 * 
 * @param normalized - Already normalized query (lowercase, no accents)
 * @returns Canonicalized query with typos corrected
 */
export function canonicalizeQuery(normalized: string): string {
  if (!normalized || normalized.trim().length === 0) {
    return normalized;
  }
  
  let result = normalized;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FIRST: Check multi-word canonical terms (e.g., "range rover", "grand cherokee")
  // This MUST happen BEFORE tokenization to prevent "rover" → "router" fuzzy match
  // Sort by length descending to match longer phrases first
  // ═══════════════════════════════════════════════════════════════════════════
  const multiWordTerms = Object.entries(CANONICAL_TERMS)
    .filter(([canonical]) => canonical.includes(" "))
    .sort((a, b) => b[0].length - a[0].length);
  
  for (const [canonical, typos] of multiWordTerms) {
    // Check if query contains the canonical form (keep it as-is)
    if (result.includes(canonical)) {
      // Mark this phrase to skip tokenization by replacing spaces with a placeholder
      result = result.replace(canonical, canonical.replace(/ /g, "\x00"));
      continue;
    }
    // Check if query contains any typo variant
    for (const typo of typos) {
      if (result.includes(typo)) {
        // Replace typo with canonical (using placeholder for spaces)
        result = result.replace(typo, canonical.replace(/ /g, "\x00"));
        break;
      }
    }
  }
  
  // THEN: Process remaining tokens individually
  const tokens = result.split(/\s+/);
  const canonicalized = tokens.map(token => {
    // If token contains placeholder, restore spaces and skip canonicalization
    if (token.includes("\x00")) {
      return token.replace(/\x00/g, " ");
    }
    return canonicalizeToken(token);
  });
  
  return canonicalized.join(" ");
}

/**
 * Check if a query was modified during canonicalization
 * Useful for logging
 */
export function wasQueryCanonicalized(original: string, canonicalized: string): boolean {
  return original !== canonicalized;
}

/**
 * Get the canonical form of a single term (for testing)
 */
export function getCanonicalTerm(term: string): string {
  return canonicalizeToken(term.toLowerCase());
}
