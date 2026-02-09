/**
 * Vehicle Guardrails — Post-fetch filtering for vehicle-like queries.
 * Ensures vehicle searches return real vehicle listings, not parts/accessories.
 * 
 * 3-tier safe fallback: strict → relaxed → unfiltered (never empty).
 */

// ─── TOKEN-AWARE MATCHING ─────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordBoundaryMatch(text: string, kw: string): boolean {
  const k = kw.toLowerCase().trim();
  if (!k) return false;
  if (k.includes(" ") && k.length > 6) return text.includes(k);
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(k)}([^a-z0-9]|$)`, "i");
  return re.test(text);
}

// ─── VEHICLE-LIKE QUERY DETECTION ─────────────────────────────────────────────

const VEHICLE_TOKENS = [
  "car","cars","suv","truck","trucks","pickup","van","vehicle","voiture",
  "camion","4x4","sedan","coupe","hatchback","convertible","wagon","crossover",
  "minivan",
];

const MOTO_TOKENS = [
  "moto","motorcycle","motorbike","scooter","quad","atv",
  "dirt bike","dual sport",
];

const CC_PATTERN = /\b\d{2,4}cc\b/i;

const MULTI_WORD_VEHICLE = [
  "model 3","model y","model s","model x","land cruiser","range rover",
  "grand cherokee","ford f-150","ford f150","cybertruck",
];

/**
 * Returns true only for strong vehicle signals (not brand-only like "toyota" which could be parts).
 * Uses token-aware boundary matching.
 */
export function isVehicleLikeQuery(qRefinedLower: string): boolean {
  const q = qRefinedLower.toLowerCase();

  // Multi-word patterns first
  if (MULTI_WORD_VEHICLE.some(p => q.includes(p))) return true;

  // Standalone vehicle-type tokens
  if (VEHICLE_TOKENS.some(t => wordBoundaryMatch(q, t))) return true;

  // Motorcycle tokens
  if (MOTO_TOKENS.some(t => wordBoundaryMatch(q, t))) return true;

  // CC pattern (125cc, 150cc, etc.)
  if (CC_PATTERN.test(q)) return true;

  // Year pattern (19xx/20xx) — only if combined with at least one other word
  if (/\b(19|20)\d{2}\b/.test(q) && q.split(/\s+/).length >= 2) return true;

  // VIN keyword
  if (wordBoundaryMatch(q, "vin")) return true;

  return false;
}

/**
 * Detect if query is motorcycle/scooter-focused (relaxes signal requirements).
 */
export function isMotorcycleLikeQuery(q: string): boolean {
  const ql = q.toLowerCase();
  if (MOTO_TOKENS.some(t => wordBoundaryMatch(ql, t))) return true;
  if (CC_PATTERN.test(ql)) return true;
  return false;
}

// ─── PARTS / ACCESSORY HARD-DROP ──────────────────────────────────────────────

const VEHICLE_PARTS_DROP: string[] = [
  // English parts
  "floor mat","floor mats","seat cover","seat covers","key fob","dash cam",
  "brake pad","brake pads","rotor","rotors","filter","oil filter","air filter",
  "cabin filter","spark plug","spark plugs","alternator","bumper","headlight",
  "tail light","taillight","mirror","side mirror","rim","rims","wiper","wipers",
  "gasket","bearing","suspension","shock","strut","hub","axle","caliper",
  "radiator","thermostat","water pump","fuel pump","timing belt","timing chain",
  "catalytic converter","exhaust","muffler","starter","ignition","distributor",
  "throttle","carburetor","turbo","intercooler","compressor",
  // Accessories
  "charger","cable","phone mount","cup holder","sun shade","sunshade",
  "cargo liner","trunk mat","mud flap","mud guard","antenna","roof rack",
  "tow hitch","trailer hitch","bike rack","car cover",
  "radio","stereo","carplay","camera","backup camera",
  // French
  "huile","pneu","pneus","jante","jantes","batterie","alternateur",
  "injecteur","pompe","joint","amortisseur","plaquette","filtre",
  "pare-choc","rétroviseur","essuie-glace","bougie",
  // Broken / junk
  "for parts","parts only","not working","broken","as-is","as is",
  "untested","read description","salvage title","non-running",
];

const PARTS_DROP_LOWER = VEHICLE_PARTS_DROP.map(k => k.toLowerCase());

function isPartAccessory(title: string): boolean {
  const t = title.toLowerCase();
  return PARTS_DROP_LOWER.some(kw => t.includes(kw));
}

// ─── VEHICLE LISTING SIGNAL ───────────────────────────────────────────────────

const BODY_TERMS = [
  "sedan","suv","truck","pickup","coupe","hatchback","van","minivan",
  "convertible","wagon","crossover","crew cab","extended cab","regular cab",
  "4d","2d","4dr","2dr","awd","fwd","rwd","4x4","4wd",
];

const MOTO_SIGNAL_TERMS = [
  "motorcycle","scooter","dirt bike","dual sport","motorbike","moto",
  "cruiser","sportbike","touring","chopper","bobber","enduro",
];

function hasVehicleListingSignal(title: string, isMotoQuery: boolean): boolean {
  const t = title.toLowerCase();
  // Year (19xx or 20xx)
  if (/\b(19|20)\d{2}\b/.test(t)) return true;
  // Mileage
  if (/\b[\d,]+\s*(miles|mi|km|k\s*miles)\b/i.test(t)) return true;
  // VIN
  if (/\bvin\b/i.test(t)) return true;
  // Body type or drivetrain terms (cars)
  if (BODY_TERMS.some(bt => wordBoundaryMatch(t, bt))) return true;

  // Motorcycle-specific signals (only checked when query is moto-like)
  if (isMotoQuery) {
    if (CC_PATTERN.test(t)) return true;
    if (MOTO_SIGNAL_TERMS.some(mt => wordBoundaryMatch(t, mt))) return true;
  }

  return false;
}

// ─── VEHICLE CATEGORY IDs (eBay) ──────────────────────────────────────────────

const VEHICLE_LISTING_CATEGORIES = new Set([
  "6000",  // eBay Motors (root)
  "6001",  // Cars & Trucks
  "6024",  // Motorcycles
  "6723",  // Powersports
  "15062", // Boats
  "10063", // RVs & Campers
  "63732", // Trailers & Other Vehicles
]);

function isVehicleListingCategory(item: unknown): boolean {
  const rec = item as Record<string, unknown>;
  // Check categoryId field
  const catId = String(rec.categoryId || rec.category_id || "");
  if (catId && VEHICLE_LISTING_CATEGORIES.has(catId)) return true;
  // Check categoryPath array
  const catPath = rec.categoryPath || rec.category_path;
  if (Array.isArray(catPath)) {
    return catPath.some((c: unknown) => {
      const id = String((c as Record<string, unknown>)?.categoryId || (c as Record<string, unknown>)?.id || c || "");
      return VEHICLE_LISTING_CATEGORIES.has(id);
    });
  }
  // Check metadata.categoryId
  const meta = rec.metadata as Record<string, unknown> | undefined;
  if (meta) {
    const metaCatId = String(meta.categoryId || meta.category_id || "");
    if (metaCatId && VEHICLE_LISTING_CATEGORIES.has(metaCatId)) return true;
  }
  return false;
}

// ─── GUARDRAIL RESULT ─────────────────────────────────────────────────────────

export interface GuardrailResult {
  items: unknown[];
  mode: "strict" | "relaxed" | "fallback" | "skipped";
  dropped: number;
  reason: string;
}

const MIN_FILTERED = 5;

/**
 * Apply vehicle guardrails with 3-tier safe fallback.
 * @param items - scored/ranked items (post intent scorer)
 * @param query - the search query
 * @param unfilteredItems - original merged list before scoring (for tier-3 fallback)
 */
export function applyVehicleGuardrails(
  items: unknown[],
  query: string,
  unfilteredItems?: unknown[],
): GuardrailResult {
  if (items.length === 0) {
    return { items, mode: "skipped", dropped: 0, reason: "empty_input" };
  }

  const isMoto = isMotorcycleLikeQuery(query);
  const getTitle = (item: unknown): string =>
    ((item as Record<string, unknown>)?.title as string) || "";

  // Tier 1: Strict — drop parts AND require vehicle signal
  const strict = items.filter(item => {
    const title = getTitle(item);
    return !isPartAccessory(title) && hasVehicleListingSignal(title, isMoto);
  });

  if (strict.length >= MIN_FILTERED) {
    return {
      items: strict,
      mode: "strict",
      dropped: items.length - strict.length,
      reason: `strict_ok(${strict.length}/${items.length})`,
    };
  }

  // Tier 2: Relaxed — drop parts, keep only items in vehicle listing categories
  const relaxed = items.filter(item => {
    if (isPartAccessory(getTitle(item))) return false;
    // If item has category info, it must be a vehicle listing category
    if (isVehicleListingCategory(item)) return true;
    // If no category info, accept it (don't drop blindly)
    const rec = item as Record<string, unknown>;
    const hasCatInfo = !!(rec.categoryId || rec.category_id ||
      rec.categoryPath || rec.category_path ||
      (rec.metadata as Record<string, unknown>)?.categoryId);
    return !hasCatInfo;
  });

  if (relaxed.length >= MIN_FILTERED) {
    return {
      items: relaxed,
      mode: "relaxed",
      dropped: items.length - relaxed.length,
      reason: `relaxed_cat_ok(${relaxed.length}/${items.length})`,
    };
  }

  // Tier 3: Fallback — return list with parts/accessories still filtered out
  const fallbackItems = unfilteredItems && unfilteredItems.length > 0 ? unfilteredItems : items;
  const cleanFallback = fallbackItems.filter(item => !isPartAccessory(getTitle(item)));
  const finalFallback = cleanFallback.length > 0 ? cleanFallback : fallbackItems;
  return {
    items: finalFallback,
    mode: "fallback",
    dropped: fallbackItems.length - finalFallback.length,
    reason: `fallback(strict=${strict.length},relaxed=${relaxed.length},clean=${cleanFallback.length},original=${fallbackItems.length})`,
  };
}
