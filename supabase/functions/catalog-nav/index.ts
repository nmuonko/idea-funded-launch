// Catalog Navigation Config - Tesla-style backend-driven navigation
// Returns drawer sections, home rails, and provider status for dynamic UI
// PUBLIC: No JWT required - cached for 5-15 minutes

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
};

interface CategoryQuery {
  title: string;
  q: string;
}

interface DrawerItem {
  slug: string;
  title: string;
  icon: string | null;
  enabled: boolean;
  source: "db" | "provider";
  providerScope: string;
  queries: CategoryQuery[];
  // Store-specific fields
  provider?: string;
  active?: boolean;
  badge?: string | null;
  providerStatusReason?: "missing_api_key" | "disabled" | null;
}

interface DrawerSection {
  sectionTitle: string;
  items: DrawerItem[];
}

interface HomeSection {
  title: string;
  slug: string;
  source: "db" | "provider";
  queries: CategoryQuery[];
}

interface ProviderInfo {
  name: string;
  displayName: string;
  enabled: boolean;
  active: boolean;
  priority: number;
  logoUrl: string | null;
  colorHex: string | null;
  providerStatusReason: "missing_api_key" | "disabled" | null;
}

interface CatalogNavResponse {
  status: "success" | "error";
  env: "production" | "staging";
  version: number;
  drawer: DrawerSection[];
  homeSections: HomeSection[];
  providers: ProviderInfo[];
  error: string | null;
}

// Map of provider name to required secret env var
const PROVIDER_SECRET_MAP: Record<string, string> = {
  rainforest: "RAINFOREST_API_KEY",
  bluecart: "BLUECART_API_KEY",
  countdown: "COUNTDOWN_API_KEY",
  redcircle: "REDCIRCLE_API_KEY",
  bigbox: "BIGBOX_API_KEY",
  serpwow: "SERPWOW_API_KEY",
  scaleserp: "SCALESERP_API_KEY",
};

// Provider display names for Stores section
const PROVIDER_STORE_NAMES: Record<string, string> = {
  rainforest: "Amazon",
  bluecart: "Walmart",
  redcircle: "Target",
  bigbox: "Home Depot",
  serpwow: "Google Shopping",
  countdown: "Countdown",
};

function getEnvironmentFromRequest(req: Request): "production" | "staging" {
  // Check header first
  const envHeader = req.headers.get("x-afrishop-environment");
  if (envHeader === "staging") return "staging";
  
  // Check query param
  const url = new URL(req.url);
  const envParam = url.searchParams.get("env");
  if (envParam === "staging") return "staging";
  
  return "production";
}

function checkProviderActive(providerName: string, secretKeyName: string | null): { active: boolean; reason: "missing_api_key" | null } {
  // Get required secret name
  const requiredSecret = secretKeyName || PROVIDER_SECRET_MAP[providerName];
  
  if (!requiredSecret) {
    // No secret required - provider is active if enabled
    return { active: true, reason: null };
  }
  
  try {
    const value = Deno.env.get(requiredSecret);
    const hasKey = value !== undefined && value !== null && value.trim().length > 0;
    return { 
      active: hasKey, 
      reason: hasKey ? null : "missing_api_key" 
    };
  } catch {
    return { active: false, reason: "missing_api_key" };
  }
}

async function fetchCatalogNav(envName: "production" | "staging"): Promise<CatalogNavResponse> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch categories, providers, and nav settings in parallel
  const [categoriesResult, providersResult, navSettingsResult] = await Promise.all([
    supabase
      .from("catalog_categories")
      .select("slug, title, group_title, enabled, priority, provider_scope, queries, icon")
      .eq("enabled", true)
      .order("priority", { ascending: false }),
    supabase
      .from("catalog_providers")
      .select("name, display_name, enabled, priority, logo_url, color_hex, capabilities, secret_key_name, environment")
      .or(`environment.eq.all,environment.eq.${envName}`)
      .order("priority", { ascending: false }),
    supabase
      .from("catalog_nav_settings")
      .select("home_sections, drawer_order, version")
      .eq("key", "default")
      .maybeSingle(),
  ]);

  const categories = categoriesResult.data || [];
  const rawProviders = providersResult.data || [];
  const navSettings = navSettingsResult.data;

  // Transform providers with active status
  const providers: ProviderInfo[] = rawProviders.map((p: any) => {
    const isEnabled = p.enabled === true;
    const { active, reason } = checkProviderActive(p.name, p.secret_key_name);
    const isActive = isEnabled && active;
    
    return {
      name: p.name,
      displayName: p.display_name || PROVIDER_STORE_NAMES[p.name] || p.name,
      enabled: isEnabled,
      active: isActive,
      priority: p.priority || 0,
      logoUrl: p.logo_url || null,
      colorHex: p.color_hex || null,
      providerStatusReason: !isEnabled ? "disabled" : reason,
    };
  });

  // Sort providers: active first, then by priority
  providers.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.priority - a.priority;
  });

  // Group categories by group_title for drawer sections
  const categoryGroups = new Map<string, DrawerItem[]>();
  
  for (const cat of categories) {
    const groupTitle = cat.group_title || "Other";
    if (!categoryGroups.has(groupTitle)) {
      categoryGroups.set(groupTitle, []);
    }
    
    categoryGroups.get(groupTitle)!.push({
      slug: cat.slug,
      title: cat.title,
      icon: cat.icon,
      enabled: cat.enabled,
      source: "db",
      providerScope: cat.provider_scope || "all",
      queries: (cat.queries || []) as CategoryQuery[],
    });
  }

  // Build drawer sections from category groups
  const drawerOrder = (navSettings?.drawer_order || ["Electronics", "Charging", "Vehicles", "Stores"]) as string[];
  const drawer: DrawerSection[] = [];

  // Add category sections in order
  for (const sectionTitle of drawerOrder) {
    if (sectionTitle === "Stores") {
      // Build Stores section from providers
      const storeItems: DrawerItem[] = providers.map(p => ({
        slug: p.name,
        title: PROVIDER_STORE_NAMES[p.name] || p.displayName,
        icon: "store",
        enabled: p.enabled,
        source: "provider" as const,
        providerScope: p.name,
        queries: [],
        provider: p.name,
        active: p.active,
        badge: p.active ? null : "Soon",
        providerStatusReason: p.providerStatusReason,
      }));
      
      if (storeItems.length > 0) {
        drawer.push({ sectionTitle: "Stores", items: storeItems });
      }
    } else {
      const items = categoryGroups.get(sectionTitle);
      if (items && items.length > 0) {
        drawer.push({ sectionTitle, items });
      }
    }
  }

  // Add any remaining sections not in drawer_order
  for (const [sectionTitle, items] of categoryGroups) {
    if (!drawerOrder.includes(sectionTitle) && items.length > 0) {
      drawer.push({ sectionTitle, items });
    }
  }

  // Build home sections from nav settings
  const homeSections: HomeSection[] = (navSettings?.home_sections || []) as HomeSection[];

  // Calculate version from latest update
  const version = navSettings?.version || 1;

  return {
    status: "success",
    env: envName,
    version,
    drawer,
    homeSections,
    providers,
    error: null,
  };
}

// Simple in-memory cache for nav config
const navCache = new Map<string, { data: CatalogNavResponse; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const envName = getEnvironmentFromRequest(req);
    const cacheKey = `catalog-nav:${envName}`;
    const now = Date.now();

    // Check cache
    const cached = navCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      console.log("[catalog-nav] Cache hit for", envName);
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch fresh data
    console.log("[catalog-nav] Fetching fresh data for", envName);
    const response = await fetchCatalogNav(envName);

    // Update cache
    navCache.set(cacheKey, { data: response, expiresAt: now + CACHE_TTL_MS });

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[catalog-nav] Error:", err);
    return new Response(
      JSON.stringify({
        status: "error",
        env: "production",
        version: 0,
        drawer: [],
        homeSections: [],
        providers: [],
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
