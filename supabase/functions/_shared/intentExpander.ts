/**
 * Intent Expander — Dynamic synonym/intent expansion for normalized queries
 * 
 * After a query has been normalized to English, this module detects product
 * intent classes and generates controlled search expansions.
 * 
 * Unlike hardcoded synonym maps, this uses pattern matching on normalized
 * queries to generate relevant alternative search terms.
 * 
 * Expansions are:
 *  - Controlled (max 3 per query)
 *  - Relevant (based on detected intent, not random)
 *  - Non-destructive (original query always searched first)
 */

// ─── INTENT EXPANSION RULES ────────────────────────────────────────────────
// Each rule: [pattern test function, expansion generator]
interface IntentRule {
  name: string;
  test: (q: string, tokens: string[]) => boolean;
  expand: (q: string, tokens: string[]) => string[];
}

const INTENT_RULES: IntentRule[] = [
  // ─── Foldable phones ─────────────────────────────────────────────────────
  {
    name: "foldable_phone",
    test: (q) => /\b(foldable|fold|flip)\b/i.test(q) && /\b(phone|samsung|galaxy|motorola)\b/i.test(q),
    expand: (q) => {
      const expansions: string[] = [];
      if (/galaxy|samsung/i.test(q)) {
        expansions.push("samsung galaxy z fold", "samsung galaxy z flip");
      } else {
        expansions.push("samsung galaxy z fold", "samsung galaxy z flip", "motorola razr");
      }
      return expansions;
    },
  },
  {
    name: "foldable_generic",
    test: (q) => /\bfoldable\b/i.test(q) && !/samsung|galaxy|motorola/i.test(q),
    expand: () => ["foldable phone", "samsung galaxy z fold", "samsung galaxy z flip"],
  },

  // ─── Laptops / Computers ─────────────────────────────────────────────────
  {
    name: "laptop",
    test: (q) => /\b(laptop|computer|notebook|ordinateur)\b/i.test(q),
    expand: (q, tokens) => {
      const brand = tokens.find(t => /^(lenovo|dell|hp|asus|acer|msi|apple|macbook)$/i.test(t));
      if (brand) {
        return [`${brand} laptop`, `${brand} notebook`];
      }
      return ["laptop", "notebook computer"];
    },
  },

  // ─── Running shoes ───────────────────────────────────────────────────────
  {
    name: "running_shoes",
    test: (q) => /\b(running|course)\b/i.test(q) && /\b(shoes|chaussure|sneakers)\b/i.test(q),
    expand: (q, tokens) => {
      const brand = tokens.find(t => /^(nike|adidas|puma|asics|new balance|reebok)$/i.test(t));
      if (brand) {
        return [`${brand} running shoes`, `${brand} athletic shoes`];
      }
      return ["running shoes", "athletic shoes", "sports shoes"];
    },
  },

  // ─── Shoes generic ───────────────────────────────────────────────────────
  {
    name: "shoes_generic",
    test: (q) => /\b(shoes|chaussure|chaussures)\b/i.test(q) && !/running|course|sport/i.test(q),
    expand: (q, tokens) => {
      const brand = tokens.find(t => /^(nike|adidas|puma|timberland|jordan|converse|vans)$/i.test(t));
      const gender = tokens.find(t => /^(men|women|kids|boys|girls)$/i.test(t));
      if (brand && gender) {
        return [`${brand} ${gender} shoes`, `${brand} ${gender} footwear`];
      }
      if (brand) return [`${brand} shoes`, `${brand} sneakers`];
      if (gender) return [`${gender} shoes`, `${gender} footwear`];
      return [];
    },
  },

  // ─── Used cars ───────────────────────────────────────────────────────────
  {
    name: "used_vehicle",
    test: (q) => /\b(used|occasion)\b/i.test(q) && /\b(car|truck|vehicle|suv)\b/i.test(q),
    expand: (q, tokens) => {
      const brand = tokens.find(t => /^(toyota|honda|ford|bmw|mercedes|nissan|hyundai|kia)$/i.test(t));
      if (brand) {
        return [`used ${brand}`, `pre-owned ${brand}`, `${brand} for sale`];
      }
      return ["used car", "pre-owned car", "car for sale"];
    },
  },

  // ─── Auto parts ──────────────────────────────────────────────────────────
  {
    name: "auto_parts",
    test: (q) => /\b(part|parts|piece|pieces)\b/i.test(q) && /\b(car|auto|toyota|honda|ford|bmw|nissan)\b/i.test(q),
    expand: (q, tokens) => {
      const brand = tokens.find(t => /^(toyota|honda|ford|bmw|mercedes|nissan|hyundai)$/i.test(t));
      if (brand) {
        return [`${brand} auto parts`, `${brand} car parts`, `OEM ${brand} parts`];
      }
      return ["auto parts", "car parts", "vehicle parts"];
    },
  },

  // ─── TVs / Televisions ──────────────────────────────────────────────────
  {
    name: "television",
    test: (q) => /\b(tv|television|televiseur|smart tv)\b/i.test(q),
    expand: (q, tokens) => {
      const brand = tokens.find(t => /^(samsung|lg|sony|hisense|tcl)$/i.test(t));
      if (brand) {
        return [`${brand} smart tv`, `${brand} television`];
      }
      return ["smart tv", "4k tv", "led tv"];
    },
  },

  // ─── Refrigerators ──────────────────────────────────────────────────────
  {
    name: "refrigerator",
    test: (q) => /\b(refrigerator|fridge|frigo|french door)\b/i.test(q),
    expand: (q) => {
      if (/double|french door/i.test(q)) {
        return ["french door refrigerator", "side by side refrigerator"];
      }
      return ["refrigerator", "fridge", "top freezer refrigerator"];
    },
  },

  // ─── Gaming ──────────────────────────────────────────────────────────────
  {
    name: "gaming",
    test: (q) => /\b(gaming|gamer)\b/i.test(q),
    expand: (q, tokens) => {
      if (/pc|computer|laptop/i.test(q)) {
        const brand = tokens.find(t => /^(asus|msi|alienware|razer|lenovo)$/i.test(t));
        if (brand) return [`${brand} gaming laptop`, `${brand} gaming pc`];
        return ["gaming laptop", "gaming pc", "gaming computer"];
      }
      if (/headset|casque/i.test(q)) return ["gaming headset", "gaming headphones"];
      if (/chair|chaise/i.test(q)) return ["gaming chair", "ergonomic gaming chair"];
      return [];
    },
  },

  // ─── Fashion / Dresses ───────────────────────────────────────────────────
  {
    name: "elegant_dress",
    test: (q) => /\b(elegant|soiree|evening|formal)\b/i.test(q) && /\b(dress|robe|gown)\b/i.test(q),
    expand: () => ["evening dress", "formal dress", "cocktail dress"],
  },
];

export interface IntentExpansionResult {
  /** Additional search queries to try */
  expansions: string[];
  /** Which intent rule matched */
  matchedIntent: string | null;
  /** Whether any expansion was generated */
  hasExpansions: boolean;
}

/**
 * Generate search expansions based on detected product intent.
 * 
 * @param normalizedQuery English-normalized query
 * @param maxExpansions Maximum expansions to return (default 3)
 */
export function expandQueryIntent(
  normalizedQuery: string,
  maxExpansions = 3,
): IntentExpansionResult {
  const q = normalizedQuery.toLowerCase().trim();
  const tokens = q.split(/\s+/);

  for (const rule of INTENT_RULES) {
    if (rule.test(q, tokens)) {
      const rawExpansions = rule.expand(q, tokens);
      // Filter out expansions identical to the original query
      const filtered = rawExpansions
        .filter(e => e.toLowerCase() !== q)
        .slice(0, maxExpansions);

      if (filtered.length > 0) {
        return {
          expansions: filtered,
          matchedIntent: rule.name,
          hasExpansions: true,
        };
      }
    }
  }

  return { expansions: [], matchedIntent: null, hasExpansions: false };
}
