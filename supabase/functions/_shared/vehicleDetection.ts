/**
 * Vehicle Detection Module
 * 
 * Extracts vehicle detection logic from catalog-search for reusability
 * and to reduce bundle size of individual functions.
 */

// Vehicle types and common terms
export const VEHICLE_QUERY_KEYWORDS = [
  // Vehicle types
  "car", "cars", "truck", "trucks", "suv", "sedan", "coupe", "pickup", "van", "minivan",
  "hatchback", "convertible", "wagon", "crossover",
  // Popular car brands
  "toyota", "honda", "jeep", "bmw", "mercedes", "ford", "chevy", "chevrolet",
  "nissan", "kia", "hyundai", "lexus", "audi", "tesla", "mazda", "subaru",
  "volkswagen", "vw", "dodge", "ram", "gmc", "cadillac", "buick", "lincoln",
  "acura", "infiniti", "genesis", "porsche", "jaguar", "land rover", "range rover",
  "volvo", "mini", "fiat", "alfa romeo", "maserati", "ferrari", "lamborghini",
  "bentley", "rolls royce", "aston martin", "mclaren", "bugatti",
  // Specific popular models
  "camry", "corolla", "rav4", "highlander", "tacoma", "tundra", "4runner", "prius",
  "civic", "accord", "cr-v", "pilot", "odyssey", "hr-v",
  "f-150", "f150", "mustang", "explorer", "escape", "bronco", "ranger",
  "silverado", "tahoe", "suburban", "colorado", "equinox", "malibu", "camaro",
  "wrangler", "grand cherokee", "gladiator", "compass", "renegade",
  "model 3", "model s", "model x", "model y", "cybertruck",
  "3 series", "5 series", "x3", "x5", "m3", "m5",
  "c-class", "e-class", "s-class", "gle", "glc", "amg",
  "a4", "a6", "q5", "q7", "r8", "rs",
  "altima", "sentra", "rogue", "pathfinder", "frontier", "titan",
  "elantra", "sonata", "tucson", "santa fe", "palisade",
  "forte", "optima", "k5", "sportage", "telluride", "sorento",
  // Motorcycles
  "motorcycle", "harley", "yamaha", "kawasaki", "ducati", "suzuki", "triumph", "indian",
  "sportster", "softail", "road king", "street glide",
  // Other vehicles
  "boat", "pontoon", "yacht", "rv", "camper", "trailer", "motorhome",
  "atv", "utv", "quad", "polaris", "can-am", "side by side", "rzr",
  // Agricultural/Heavy equipment
  "tractor", "tractors", "tracteur", "tracteurs", "bulldozer", "excavator",
  "john deere", "kubota", "massey ferguson", "case ih", "new holland", "caterpillar",
  // French vehicle terms + English generic
  "voiture", "voitures", "moto", "camion", "vehicule", "vehicle", "vehicles", "automobile",
];

// Keywords indicating user wants to BUY a vehicle
export const VEHICLE_BUYING_INTENT_KEYWORDS = [
  "for sale", "à vendre", "buy", "acheter", "purchase",
  "used car", "new car", "certified pre-owned", "cpo",
  "dealer", "dealership", "financing", "lease",
  "used", "pre-owned", "preowned",
];

// Keywords indicating user wants vehicle accessories/parts
export const VEHICLE_ACCESSORY_KEYWORDS = [
  "floor mat", "floor mats", "mat", "mats", "cover", "covers", "case",
  "filter", "oil filter", "air filter", "cabin filter",
  "brake", "brakes", "brake pad", "brake pads",
  "part", "parts", "accessory", "accessories",
  "key fob", "key", "remote", "fob",
  "battery", "batteries",
  "tire", "tires", "wheel", "wheels", "rim", "rims",
  "seat cover", "seat covers", "cargo", "liner", "liners",
  "sunshade", "visor", "windshield",
  "headlight", "taillight", "bulb", "led",
  "mirror", "antenna", "wiper", "wipers",
  "charger", "adapter", "mount", "holder",
  "emblem", "badge", "decal", "sticker",
  "radio", "stereo", "speaker", "amplifier", "subwoofer",
  "gps", "dash cam", "camera", "sensor",
  "floor", "carpet", "trunk", "cargo net",
  "phone", "tablet", "iphone", "samsung", "android",
];

// Extended toy/accessory keywords for filtering
export const VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS = [
  // Toys and models
  "matchbox", "diecast", "die-cast", "die cast", "hot wheels", "hotwheels",
  "1:64", "1:43", "1:24", "1:18", "1:12", "1/64", "1/43", "1/24", "1/18",
  "toy", "lego", "rc car", "remote control", "model car", "toy car", "scale model",
  "miniature", "collectible", "replica", "playset",
  // Clothing & Merch
  "shirt", "t-shirt", "tshirt", "hoodie", "sweatshirt", "sweater", "jacket",
  "hat", "cap", "beanie", "snapback", "trucker hat",
  "polo", "jersey", "vest", "coat", "windbreaker",
  "pants", "shorts", "jeans", "joggers",
  "shoes", "sneakers", "slippers", "sandals", "boots",
  "bag", "backpack", "duffel", "tote", "messenger bag",
  "watch", "sunglasses", "glasses", "belt", "wallet", "purse",
  "mug", "cup", "tumbler", "bottle", "water bottle",
  "blanket", "towel", "flag", "banner",
  // Vehicle accessories
  "floor mat", "floor mats", "mat set", "all weather mat",
  "key fob", "key cover", "fob cover", "remote cover", "key chain", "keychain",
  "wiper", "wipers", "wiper blade", "wiper blades",
  "sunshade", "sun shade", "windshield cover", "windshield shade",
  "car cover", "seat cover", "seat covers", "cargo liner",
  "emblem", "badge", "decal", "sticker", "logo",
  "led", "light", "lights", "headlight", "taillight", "bulb", "bulbs",
  // Phone accessories often have car names
  "phone case", "phone holder", "car mount", "phone mount", "cup holder",
  // Decorative items
  "poster", "wall art", "canvas", "print", "artwork", "framed",
  // Parts keywords
  "oem", "aftermarket", "replacement", "fitment", "fits", "compatible", "kit",
  "bumper", "grille", "grill", "headlight", "taillight", "fog light",
  "brake", "brakes", "brake pad", "brake pads", "brake rotor", "rotor", "caliper",
  "filter", "oil filter", "air filter", "cabin filter", "fuel filter",
  "sensor", "oxygen sensor", "o2 sensor", "mass air flow", "maf",
  "spark plug", "spark plugs", "ignition coil", "coil pack",
  "belt", "serpentine belt", "timing belt", "timing chain",
  "alternator", "starter", "water pump", "fuel pump", "power steering",
  "radiator", "thermostat", "hose", "coolant",
  "suspension", "strut", "struts", "shock", "shocks", "spring", "springs",
  "control arm", "ball joint", "tie rod", "sway bar", "bushing",
  "exhaust", "muffler", "catalytic converter", "cat converter",
  "clutch", "transmission", "flywheel", "axle", "cv joint", "cv axle",
  "bearing", "hub", "wheel bearing", "hub assembly",
  "gasket", "head gasket", "valve cover", "intake manifold",
  "mirror", "side mirror", "door handle", "window regulator",
  "antenna", "radio", "stereo", "amplifier", "subwoofer", "speaker",
];

// Vehicle brand aliases
export const VEHICLE_BRAND_ALIASES: string[] = [
  // American
  "ford", "chevrolet", "chevy", "gmc", "dodge", "ram", "jeep", "chrysler",
  "buick", "cadillac", "lincoln", "tesla",
  // Japanese
  "toyota", "honda", "nissan", "mazda", "subaru", "lexus", "acura", "infiniti",
  "mitsubishi", "suzuki", "daihatsu", "isuzu",
  // Korean
  "hyundai", "kia", "genesis",
  // German
  "bmw", "mercedes", "audi", "volkswagen", "vw", "porsche", "mini",
  // European
  "volvo", "jaguar", "land rover", "range rover", "alfa romeo", "fiat", "maserati",
  "ferrari", "lamborghini", "bentley", "rolls royce", "aston martin", "mclaren", "peugeot", "renault", "citroen",
  // British
  "lotus", "mgb",
  // Motorcycles
  "harley", "harley davidson", "kawasaki", "ducati", "triumph", "indian", "ktm", "aprilia",
  // Other vehicles
  "freightliner", "peterbilt", "kenworth", "mack", "international",
];

// Vehicle model patterns for brand+model detection
export const VEHICLE_MODEL_PATTERNS: Array<{ brand: string; models: string[] }> = [
  { brand: "infiniti", models: ["qx80", "qx60", "qx55", "qx50", "q50", "q60", "q70", "fx35", "fx45", "g35", "g37", "m35", "m37", "m45", "m56"] },
  { brand: "lexus", models: ["rx350", "rx450", "es350", "es300", "ls460", "ls500", "gx460", "gx470", "lx570", "lx600", "nx350", "ux250", "is350", "is300", "is250", "gs350", "gs300", "rc350"] },
  { brand: "acura", models: ["mdx", "rdx", "tlx", "ilx", "nsx", "integra", "rlx", "zdx"] },
  { brand: "bmw", models: ["x5", "x3", "x7", "x1", "x6", "m3", "m5", "m4", "330i", "530i", "540i", "750i", "840i"] },
  { brand: "mercedes", models: ["gle", "glc", "gls", "amg", "c300", "e350", "s550", "g550", "g63", "cla", "cls"] },
  { brand: "audi", models: ["q5", "q7", "q8", "a4", "a6", "a8", "s4", "s5", "rs7", "rs6", "tt", "r8", "e-tron", "etron"] },
  { brand: "porsche", models: ["cayenne", "macan", "panamera", "taycan", "911", "718", "cayman", "boxster"] },
  { brand: "toyota", models: ["camry", "corolla", "rav4", "highlander", "tacoma", "tundra", "4runner", "prius", "sienna", "venza", "sequoia", "supra", "gr86", "land cruiser", "landcruiser"] },
  { brand: "honda", models: ["civic", "accord", "cr-v", "crv", "pilot", "odyssey", "hr-v", "hrv", "ridgeline", "passport", "fit", "insight"] },
  { brand: "ford", models: ["f-150", "f150", "f-250", "f250", "mustang", "explorer", "escape", "bronco", "ranger", "expedition", "edge", "maverick", "raptor"] },
  { brand: "chevrolet", models: ["silverado", "tahoe", "suburban", "colorado", "equinox", "malibu", "camaro", "corvette", "traverse", "blazer", "trax", "bolt"] },
  { brand: "chevy", models: ["silverado", "tahoe", "suburban", "colorado", "equinox", "malibu", "camaro", "corvette", "traverse", "blazer", "trax", "bolt"] },
  { brand: "jeep", models: ["wrangler", "grand cherokee", "cherokee", "gladiator", "compass", "renegade", "wagoneer", "grand wagoneer"] },
  { brand: "tesla", models: ["model 3", "model s", "model x", "model y", "cybertruck"] },
  { brand: "nissan", models: ["altima", "sentra", "rogue", "pathfinder", "frontier", "titan", "maxima", "murano", "armada", "kicks", "leaf", "z", "370z", "350z"] },
  { brand: "hyundai", models: ["elantra", "sonata", "tucson", "santa fe", "palisade", "kona", "ioniq", "venue", "genesis"] },
  { brand: "kia", models: ["forte", "optima", "k5", "sportage", "telluride", "sorento", "seltos", "carnival", "niro", "ev6", "stinger"] },
  { brand: "dodge", models: ["charger", "challenger", "durango", "ram", "journey", "hornet"] },
  { brand: "ram", models: ["1500", "2500", "3500", "promaster"] },
  { brand: "gmc", models: ["sierra", "yukon", "acadia", "terrain", "canyon", "denali", "hummer"] },
  { brand: "subaru", models: ["outback", "forester", "crosstrek", "impreza", "wrx", "brz", "ascent", "legacy"] },
  { brand: "mazda", models: ["cx-5", "cx5", "cx-9", "cx9", "cx-30", "cx30", "mazda3", "mazda6", "mx-5", "miata"] },
  { brand: "volkswagen", models: ["jetta", "passat", "tiguan", "atlas", "golf", "gti", "id.4", "id4", "taos", "arteon"] },
  { brand: "vw", models: ["jetta", "passat", "tiguan", "atlas", "golf", "gti", "id.4", "id4", "taos", "arteon"] },
  { brand: "volvo", models: ["xc90", "xc60", "xc40", "s60", "s90", "v60", "v90"] },
  { brand: "cadillac", models: ["escalade", "xt5", "xt6", "ct5", "ct4", "lyriq"] },
  { brand: "lincoln", models: ["navigator", "aviator", "corsair", "nautilus"] },
  { brand: "genesis", models: ["g80", "g70", "g90", "gv80", "gv70", "gv60"] },
  { brand: "jaguar", models: ["f-pace", "e-pace", "i-pace", "xe", "xf", "xj", "f-type"] },
  { brand: "land rover", models: ["range rover", "discovery", "defender", "evoque", "velar"] },
  { brand: "range rover", models: ["sport", "velar", "evoque", "autobiography"] },
];

// Standalone vehicle patterns (single names that indicate vehicle intent)
export const STANDALONE_VEHICLE_PATTERNS: RegExp[] = [
  // Luxury/premium brands
  /\bcadillac\b/i, /\blincoln\b/i, /\bbuick\b/i, /\binfiniti\b/i, /\bacura\b/i,
  /\blexus\b/i, /\bgenesis\b/i, /\bporsche\b/i, /\bjaguar\b/i, /\bland\s*rover\b/i,
  /\brange\s*rover\b/i, /\bbentley\b/i, /\bmaserati\b/i, /\bferrari\b/i,
  /\blamborghini\b/i, /\brolls\s*royce\b/i, /\baston\s*martin\b/i, /\bmclaren\b/i,
  /\bbugatti\b/i, /\blotus\b/i, /\balfa\s*romeo\b/i, /\btesla\b/i, /\bjeep\b/i,
  // Mainstream brands
  /\btoyota\b/i, /\bhonda\b/i, /\bnissan\b/i, /\bford\b/i, /\bchevrolet\b/i,
  /\bchevy\b/i, /\bdodge\b/i, /\bram\b/i, /\bgmc\b/i, /\bbmw\b/i, /\bmercedes\b/i,
  /\baudi\b/i, /\bvolkswagen\b/i, /\bvw\b/i, /\bhyundai\b/i, /\bkia\b/i,
  /\bmazda\b/i, /\bsubaru\b/i, /\bvolvo\b/i, /\bchrysler\b/i, /\bpeugeot\b/i,
  /\brenault\b/i, /\bcitroen\b/i, /\bmitsubishi\b/i, /\bfiat\b/i,
  // Iconic vehicle names
  /\bmodel\s*3\b/i, /\bmodel\s*s\b/i, /\bmodel\s*x\b/i, /\bmodel\s*y\b/i,
  /\bcybertruck\b/i, /\bf[-\s]?150\b/i, /\bf[-\s]?250\b/i, /\bf[-\s]?350\b/i,
  /\bgrand\s*cherokee\b/i, /\bwrangler\b/i, /\bgladiator\b/i, /\bsilverado\b/i,
  /\btahoe\b/i, /\bsuburban\b/i, /\bram\s*1500\b/i, /\bram\s*2500\b/i,
  /\bram\s*3500\b/i, /\bchallenger\b/i, /\bcharger\b/i, /\bmustang\b/i,
  /\bcorvette\b/i, /\bcamaro\b/i, /\bgt[-\s]?r\b/i, /\bescalade\b/i,
  /\bnavigator\b/i, /\bg[-\s]?wagon\b/i, /\bbronco\b/i, /\bprius\b/i,
  /\bmiata\b/i, /\b911\b/i,
];

// Vehicle signal patterns for validation
export const VEHICLE_SIGNAL_PATTERNS = {
  year: /(19|20)\d{2}/,
  alphanumeric: /\b[a-z]+\d+[a-z]?\b|\b\d+[a-z]+[a-z0-9]*\b/i,
  keywords: [
    "suv", "truck", "pickup", "sedan", "coupe", "4x4", "awd", "4wd", "2wd", "fwd", "rwd",
    "miles", "mileage", "vin", "engine", "transmission", "v6", "v8", "v4", "turbo",
    "hybrid", "electric", "diesel", "automatic", "manual", "convertible", "wagon",
    "hatchback", "crossover", "for sale", "buy", "used", "certified", "preowned",
    "pre-owned", "cpo", "dealer", "financing", "lease",
  ],
};

/**
 * Check if query contains a vehicle-specific signal
 */
export function hasVehicleSignal(query: string): { hasSignal: boolean; signal: string | null } {
  const lower = query.toLowerCase();
  
  if (VEHICLE_SIGNAL_PATTERNS.year.test(lower)) {
    const match = lower.match(VEHICLE_SIGNAL_PATTERNS.year);
    return { hasSignal: true, signal: `year:${match?.[0]}` };
  }
  
  if (VEHICLE_SIGNAL_PATTERNS.alphanumeric.test(lower)) {
    const match = lower.match(VEHICLE_SIGNAL_PATTERNS.alphanumeric);
    return { hasSignal: true, signal: `alphanumeric:${match?.[0]}` };
  }
  
  for (const keyword of VEHICLE_SIGNAL_PATTERNS.keywords) {
    if (lower.includes(keyword)) {
      return { hasSignal: true, signal: `keyword:${keyword}` };
    }
  }
  
  return { hasSignal: false, signal: null };
}

/**
 * Check if a query is "ambiguous" (could be vehicles OR electronics/merch)
 */
export function isAmbiguousQuery(query: string): boolean {
  const lower = query.toLowerCase().trim();
  const tokens = lower.split(/\s+/).filter(t => t.length > 0);
  
  if (tokens.length === 1) return true;
  
  if (tokens.length === 2) {
    const signal = hasVehicleSignal(lower);
    if (signal.hasSignal) return false;
    return true;
  }
  
  return false;
}

/**
 * Check if query is a simple vehicle-related query
 */
export function isVehicleQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return VEHICLE_QUERY_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Check if query contains a known vehicle make+model combination
 */
export function isVehicleMakeModelQuery(query: string): boolean {
  const lower = query.toLowerCase().trim();
  
  // Check for accessory/toy keywords FIRST
  const hasAccessoryKeywords = VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw => lower.includes(kw));
  if (hasAccessoryKeywords) {
    return false;
  }
  
  // Check for standalone vehicle names
  for (const pattern of STANDALONE_VEHICLE_PATTERNS) {
    if (pattern.test(lower)) {
      return true;
    }
  }
  
  // Check for brand + model combinations
  for (const { brand, models } of VEHICLE_MODEL_PATTERNS) {
    const brandRegex = new RegExp(`\\b${brand}\\b`, 'i');
    if (brandRegex.test(lower)) {
      for (const model of models) {
        if (lower.includes(model)) {
          return true;
        }
      }
    }
  }
  
  // Brand fallback: Brand + 2+ tokens + vehicle signal
  const tokens = lower.split(/\s+/);
  if (tokens.length >= 2) {
    const vehicleSignal = hasVehicleSignal(lower);
    
    for (const brand of VEHICLE_BRAND_ALIASES) {
      const brandRegex = new RegExp(`\\b${brand.replace(/\s+/g, "\\s+")}\\b`, 'i');
      if (brandRegex.test(lower)) {
        if (vehicleSignal.hasSignal) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Check if a query indicates explicit vehicle-BUYING intent
 */
export function hasVehicleBuyingIntent(query: string): boolean {
  const lower = query.toLowerCase().trim();
  
  // Check for accessory/parts keywords
  const hasAccessoryKeywords = VEHICLE_ACCESSORY_KEYWORDS.some(kw => lower.includes(kw));
  if (hasAccessoryKeywords) {
    return false;
  }
  
  // Check for explicit buying intent keywords
  const hasExplicitBuyingIntent = VEHICLE_BUYING_INTENT_KEYWORDS.some(kw => lower.includes(kw));
  if (hasExplicitBuyingIntent) {
    return true;
  }
  
  // Check for make+model combinations
  if (isVehicleMakeModelQuery(query)) {
    return true;
  }
  
  return false;
}

/**
 * Build vehicle probe cache key
 */
export function buildVehicleProbeKey(query: string): string {
  const qNorm = query.toLowerCase().trim().replace(/\s+/g, "_");
  return `vehicle_probe:v1:${qNorm}`;
}

export interface VehicleProbeResult {
  vehicleMode: boolean;
  vehiclesFound: number;
  probeSource: "cache" | "live";
  reason: string;
}

// ─── HEAVY EQUIPMENT DETECTION ────────────────────────────────────────────────
// These queries match isVehicleQuery but should NOT be treated as passenger
// vehicles (no Cars & Trucks category, no Autos category, no $1000 minPrice)

const HEAVY_EQUIPMENT_KEYWORDS = [
  "tractor", "tractors", "tracteur", "tracteurs",
  "bulldozer", "bulldozers", "excavator", "excavators",
  "loader", "loaders", "backhoe", "backhoes",
  "skid steer", "forklift", "forklifts",
  "crane", "cranes", "grader", "graders",
  "combine", "harvester", "harvesters",
  "plow", "plough", "mower", "mowers",
  "john deere", "kubota", "massey ferguson", "case ih", "new holland",
  "caterpillar", "cat ", "komatsu", "bobcat", "hitachi",
  "agricole", "agricultural", "farm equipment", "farm tractor",
  "tondeuse", // French for lawn mower
];

/**
 * Check if query is about heavy/agricultural equipment (NOT passenger vehicles)
 * These should NOT get Cars & Trucks category or Autos category or $1000 minPrice
 */
export function isHeavyEquipmentQuery(query: string): boolean {
  const lower = query.toLowerCase().trim();
  return HEAVY_EQUIPMENT_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── INTENT CLASSIFICATION ────────────────────────────────────────────────────

export const VEHICLE_PARTS_KEYWORDS = [
  "brake","rotor","pad","bumper","headlight","tail light","mirror","sensor","filter",
  "oil","spark","alternator","starter","radiator","injector","strut","shock","caliper",
  "wheel","rim","tire","tyre","hub","bearing","axle","cv","control arm","suspension",
  "gasket","oem","aftermarket","floor mat","mats","carplay","stereo","radio","dash",
  "camera","backup camera","mount","holder","charger","case","cover","accessory",
  "accessories","led","bulb","light bar","wiper","antenna","fuse","relay","hose",
  "belt","clutch","muffler","exhaust","catalytic","converter","transmission fluid",
  // French vehicle parts keywords
  "pneus","jante","plaquette","huile","alternateur","demarreur","démarreur",
  "filtre","amortisseur","bougies","courroie","embrayage","pot d'echappement",
];

export const PHONE_ACCESSORY_KEYWORDS = [
  "case","cover","screen protector","protector","charger","cable","usb","adapter",
  "headphones","earbuds","airpods","magsafe","mount","holder","ring","pop socket",
  "lens","tempered glass","battery pack","power bank","wireless charger","stand",
  "strap","band","dock","cradle","skin","decal","folio","wallet case","otterbox",
  "spigen","armband",
  // French phone accessory keywords
  "coque","protection ecran","protection écran","batterie externe","chargeur sans fil",
];

const PHONE_BRAND_PATTERNS = [
  "iphone","samsung","galaxy","pixel","xiaomi","tecno","infinix","itel",
  "oneplus","oppo","vivo","nokia","motorola","moto","huawei","honor","realme",
  "redmi","poco","nothing phone","zenfone","rog phone","xperia",
];

const PHONE_MODEL_RE = /\b(a\d{2,3}|s\d{2,3}(\s?ultra|\s?plus|\s?fe)?|pixel\s?\d+a?|iphone\s?\d+(\s?pro(\s?max)?|\s?plus|\s?mini)?|galaxy\s?(z\s?fold|z\s?flip)\s?\d*|note\s?\d+|redmi\s?note\s?\d+)\b/i;

const VEHICLE_LISTING_MODELS = [
  "rav4","crv","cr-v","civic","corolla","camry","highlander","yukon","tahoe",
  "santa fe","sportage","cx-5","cx5","rx 350","rx350","gle 350","gle350",
  "x5","q5","accord","pilot","4runner","prado","land cruiser","landcruiser",
  "hilux","sequoia","venza","supra","gr86",
  "f-150","f150","silverado","wrangler","grand cherokee","mustang","challenger",
  "charger","model 3","model s","model y","model x","cybertruck","bronco",
  "tacoma","tundra","frontier","titan","sierra","colorado","equinox","rogue",
  "pathfinder","altima","sentra","elantra","sonata","tucson","palisade",
  "forte","optima","k5","telluride","sorento","outback","forester","crosstrek",
  "wrx","impreza","jetta","tiguan","atlas","golf","xc90","xc60","escalade",
  "navigator","aviator","g80","g70","gv80","defender","discovery","evoque",
  "cayenne","macan","panamera","taycan","911","durango","ram 1500","ram 2500",
  "c300","e350","s550","g550","g63","cla","cls",
];

function hasAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

function isLikelyVehicleMakeModelQuery(qNorm: string): boolean {
  // Check brand + model combos
  for (const { brand, models } of VEHICLE_MODEL_PATTERNS) {
    if (qNorm.includes(brand)) {
      for (const model of models) {
        if (qNorm.includes(model)) return true;
      }
    }
  }
  // Check standalone listing models
  return VEHICLE_LISTING_MODELS.some(m => qNorm.includes(m));
}

function hasYearToken(text: string): boolean {
  return /\b(19|20)\d{2}\b/.test(text);
}

function hasMileageToken(text: string): boolean {
  return /\b(miles|mi|km|kilometers|kilometres|odometer|mileage)\b/i.test(text);
}

export interface SearchIntent {
  intentKey: "vehicle_listing" | "vehicle_parts" | "phone_device" | "phone_accessory" | "heavy_equipment" | "gaming" | "general";
  vehicleListingIntent: boolean;
  vehiclePartsIntent: boolean;
  phoneDeviceIntent: boolean;
  phoneAccessoryIntent: boolean;
  isHeavyEquipment: boolean;
}

/**
 * Classify search intent from a normalized query.
 * Returns an intent key that drives provider routing, scoring, and cache separation.
 */
export function classifySearchIntent(qNorm: string): SearchIntent {
  const lower = qNorm.toLowerCase().trim();

  const isHeavyEquip = isHeavyEquipmentQuery(lower);
  const vehicleIntent = isLikelyVehicleMakeModelQuery(lower) || isVehicleQuery(lower);
  const vehiclePartsIntent = vehicleIntent && hasAny(lower, VEHICLE_PARTS_KEYWORDS) && !isHeavyEquip;
  const vehicleListingIntent = vehicleIntent && !vehiclePartsIntent && !isHeavyEquip;

  const phoneIntent = hasAny(lower, PHONE_BRAND_PATTERNS) || PHONE_MODEL_RE.test(lower);
  const phoneAccessoryIntent = phoneIntent && hasAny(lower, PHONE_ACCESSORY_KEYWORDS);
  const phoneDeviceIntent = phoneIntent && !phoneAccessoryIntent;

  const GAMING_KW = ["xbox","ps5","ps4","playstation","nintendo","switch","console","gaming console","video game","video games"];
  const gamingIntent = !vehicleIntent && !phoneIntent && hasAny(lower, GAMING_KW);

  let intentKey: SearchIntent["intentKey"];
  if (isHeavyEquip) intentKey = "heavy_equipment";
  else if (vehicleListingIntent) intentKey = "vehicle_listing";
  else if (vehiclePartsIntent) intentKey = "vehicle_parts";
  else if (phoneDeviceIntent) intentKey = "phone_device";
  else if (phoneAccessoryIntent) intentKey = "phone_accessory";
  else if (gamingIntent) intentKey = "gaming";
  else intentKey = "general";

  return { intentKey, vehicleListingIntent, vehiclePartsIntent, phoneDeviceIntent, phoneAccessoryIntent, isHeavyEquipment: isHeavyEquip };
}

// Re-export helpers for scoring module (use aliases to avoid duplicate export errors)
export { hasAny, hasYearToken, hasMileageToken, VEHICLE_PARTS_KEYWORDS as VEHICLE_PARTS_KW };
export { PHONE_ACCESSORY_KEYWORDS as PHONE_ACCESSORY_KW };
