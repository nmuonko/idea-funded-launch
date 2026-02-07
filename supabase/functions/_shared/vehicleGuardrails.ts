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
  "125cc","150cc","200cc","250cc","300cc","450cc","600cc","650cc","750cc","1000cc",
];

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

  // Multi-word patterns first (exact substring is safe for long phrases)
  if (MULTI_WORD_VEHICLE.some(p => q.includes(p))) return true;

  // Standalone vehicle-type tokens
  if (VEHICLE_TOKENS.some(t => wordBoundaryMatch(q, t))) return true;

  // Motorcycle tokens
  if (MOTO_TOKENS.some(t => wordBoundaryMatch(q, t))) return true;

  // Year pattern (19xx/20xx) — only if combined with at least one other word
  if (/\b(19|20)\d{2}\b/.test(q) && q.split(/\s+/).length >= 2) return true;

  // VIN keyword
  if (wordBoundaryMatch(q, "vin")) return true;

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

// Pre-compile to lowercase for fast lookup
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

function hasVehicleListingSignal(title: string): boolean {
  const t = title.toLowerCase();
  // Year (19xx or 20xx)
  if (/\b(19|20)\d{2}\b/.test(t)) return true;
  // Mileage
  if (/\b[\d,]+\s*(miles|mi|km|k\s*miles)\b/i.test(t)) return true;
  // VIN
  if (/\bvin\b/i.test(t)) return true;
  // Body type or drivetrain terms
  if (BODY_TERMS.some(bt => wordBoundaryMatch(t, bt))) return true;
  return false;
}

// ─── GUARDRAIL RESULT ─────────────────────────────────────────────────────────

export interface GuardrailResult {
  items: unknown[];
  mode: "strict" | "relaxed" | "fallback" | "skipped";
  dropped: number;
  reason: string;
}

const MIN_FILTERED = 20;

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

  const getTitle = (item: unknown): string =>
    ((item as Record<string, unknown>)?.title as string) || "";

  // Tier 1: Strict — drop parts AND require vehicle signal
  const strict = items.filter(item => {
    const title = getTitle(item);
    return !isPartAccessory(title) && hasVehicleListingSignal(title);
  });

  if (strict.length >= MIN_FILTERED) {
    return {
      items: strict,
      mode: "strict",
      dropped: items.length - strict.length,
      reason: `strict_ok(${strict.length}/${items.length})`,
    };
  }

  // Tier 2: Relaxed — drop parts only, no signal requirement
  const relaxed = items.filter(item => !isPartAccessory(getTitle(item)));

  if (relaxed.length >= MIN_FILTERED) {
    return {
      items: relaxed,
      mode: "relaxed",
      dropped: items.length - relaxed.length,
      reason: `relaxed_ok(${relaxed.length}/${items.length})`,
    };
  }

  // Tier 3: Fallback — return original unfiltered list
  const fallbackItems = unfilteredItems && unfilteredItems.length > 0 ? unfilteredItems : items;
  return {
    items: fallbackItems,
    mode: "fallback",
    dropped: 0,
    reason: `fallback(strict=${strict.length},relaxed=${relaxed.length},original=${fallbackItems.length})`,
  };
}
