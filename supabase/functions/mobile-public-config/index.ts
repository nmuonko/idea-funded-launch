// Mobile Public Config Endpoint - OPTIMIZED FOR 10K+ USERS
// Returns cart configuration for guest users (exchange rate, markup, shipping)
// PUBLIC: No JWT required - callable with apikey only
// Source of truth: `settings` table with aggressive caching

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { coalesce, CACHE_TTL, makeCacheKey } from "../_shared/responseCache.ts";
import { withLoadShedding, getEndpointPriority, LoadSheddingError, loadSheddingResponse } from "../_shared/loadShedding.ts";
import { getEnvironmentFromRequest, getEnvironmentConfig, EnvironmentConfig } from "../_shared/environmentResolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
};

interface ProviderCapabilities {
  home?: boolean;
  search?: boolean;
  product?: boolean;
  offers?: boolean;
}

interface CatalogProvider {
  name: string;
  displayName: string;
  active: boolean;
  enabled: boolean;
  priority: number;
  logoUrl: string | null;
  colorHex: string | null;
  capabilities: ProviderCapabilities;
  providerStatusReason: "missing_api_key" | "disabled" | null;
}

// Tesla-style navigation types
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

interface CatalogNavConfig {
  version: number;
  drawer: DrawerSection[];
  homeSections: HomeSection[];
}

interface PublicConfigResponse {
  success: boolean;
  configValid: boolean;
  reason?: string;
  // TOP-LEVEL env fields for mobile debugging
  env: "production" | "staging";
  catalogEnabled: boolean;
  catalogMode: "webview" | "native" | "hybrid";
  // Standard config
  exchangeRate: number;
  markup: {
    type: "percent" | "fixed";
    value: number;
    vehicleValue?: number;
  };
  shipping: {
    mode: "flat" | "percent" | "combined";
    flatUsd: number;
    percentValue: number;
  };
  serviceFee: {
    percent: number;
    minUsd: number;
  };
  limits: {
    maishapayMaxUsd: number;
    maishapayMaxCdf: number;
  };
  currency: string;
  updated_at: string;
  version: number;
  
  // Catalog configuration (detailed)
  catalog: {
    enabled: boolean;
    mode: "webview" | "native" | "hybrid";
    apiBaseUrl: string;
    providers: string[];
    refreshIntervalMs: number;
  };
  
  // NEW: Full provider list for dynamic UI rendering
  catalogProviders: CatalogProvider[];
  defaultProvider: string;
  providerUiMode: "tabs" | "dropdown" | "chips";
  
  // NEW: Tesla-style navigation config
  catalogNav: CatalogNavConfig;
  catalogNavVersion: number;
  
  // Environment details (full info)
  envDetails: {
    name: "production" | "staging";
    minSupportedAppVersion: string;
    ota: {
      enabled: boolean;
      channel: string;
    };
  };
}

// Provider display names for Stores section
const PROVIDER_STORE_NAMES: Record<string, string> = {
  rainforest: "Amazon",
  ebay: "eBay",
  bluecart: "Walmart",
  redcircle: "Target",
  bigbox: "Home Depot",
  serpwow: "Google Shopping",
  countdown: "Countdown",
};

async function fetchConfig(envName: "production" | "staging"): Promise<PublicConfigResponse> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch settings, environment config, providers, categories, and nav settings in parallel
  const [settingsResult, envConfig, providersResult, categoriesResult, navSettingsResult] = await Promise.all([
    supabase
      .from("settings")
      .select(`
        exchange_rate_usd_to_cdf,
        markup_percent,
        global_markup_percent,
        category_markups,
        shipping_base_fee_usd,
        shipping_percent,
        service_fee_percent,
        min_service_fee_usd,
        maishapay_max_usd,
        maishapay_max_cdf,
        updated_at
      `)
      .limit(1)
      .maybeSingle(),
    getEnvironmentConfig(supabase, envName),
    supabase
      .from("catalog_providers")
      .select("name, display_name, enabled, priority, logo_url, color_hex, capabilities, requires_keys, adapter_name, secret_key_name")
      .or(`environment.eq.all,environment.eq.${envName}`)
      .order("priority", { ascending: false }),
    supabase
      .from("catalog_categories")
      .select("slug, title, group_title, enabled, priority, provider_scope, queries, icon")
      .eq("enabled", true)
      .order("priority", { ascending: false }),
    supabase
      .from("catalog_nav_settings")
      .select("home_sections, drawer_order, version")
      .eq("key", "default")
      .maybeSingle(),
  ]);

  const { data: settings, error } = settingsResult;
  const rawProviders = providersResult.data || [];
  
  // Map of provider name/adapter to required secret env var
  const PROVIDER_SECRET_MAP: Record<string, string> = {
    rainforest: "RAINFOREST_API_KEY",
    ebay: "EBAY_CLIENT_ID",
    bluecart: "BLUECART_API_KEY",
    countdown: "COUNTDOWN_API_KEY",
    redcircle: "REDCIRCLE_API_KEY",
    bigbox: "BIGBOX_API_KEY",
    serpwow: "SERPWOW_API_KEY",
    scaleserp: "SCALESERP_API_KEY",
  };
  
  // Transform providers with active status check
  const catalogProviders: CatalogProvider[] = rawProviders.map((p: any) => {
    const isEnabled = p.enabled === true;
    
    // Check if required API key exists
    let requiredSecret: string | null = null;
    if (p.requires_keys && typeof p.requires_keys === 'object' && p.requires_keys.apiKeySecret) {
      requiredSecret = p.requires_keys.apiKeySecret;
    } else {
      const adapterName = p.adapter_name || p.name;
      requiredSecret = PROVIDER_SECRET_MAP[adapterName] || null;
    }
    
    let hasRequiredKey = true;
    if (requiredSecret) {
      try {
        const value = Deno.env.get(requiredSecret);
        hasRequiredKey = value !== undefined && value !== null && value.trim().length > 0;
      } catch {
        hasRequiredKey = false;
      }
    }
    
    const isActive = isEnabled && hasRequiredKey;
    
    let statusReason: "missing_api_key" | "disabled" | null = null;
    if (!isEnabled) statusReason = "disabled";
    else if (!hasRequiredKey) statusReason = "missing_api_key";
    
    return {
      name: p.name,
      displayName: p.display_name,
      active: isActive,
      enabled: isEnabled,
      priority: p.priority || 0,
      logoUrl: p.logo_url || null,
      colorHex: p.color_hex || null,
      capabilities: {
        home: p.capabilities?.home ?? false,
        search: p.capabilities?.search ?? false,
        product: p.capabilities?.product ?? false,
        offers: p.capabilities?.offers ?? false,
      },
      providerStatusReason: statusReason,
    };
  });
  
  // Sort by active first, then priority
  catalogProviders.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.priority - a.priority;
  });
  
  const activeProviders = catalogProviders.filter(p => p.active);
  const enabledProviders = activeProviders.map(p => p.name);
  const defaultProvider = activeProviders.length > 0 ? activeProviders[0].name : "all";
  const providerUiMode = activeProviders.length <= 4 ? "tabs" : "dropdown";

  if (error) {
    console.error("[mobile-public-config] Database error:", error.message);
    throw new Error(`DATABASE_ERROR: ${error.message}`);
  }

  // Build catalog config from environment
  const catalogConfig = {
    enabled: envConfig?.catalog_enabled ?? false,
    mode: (envConfig?.catalog_mode ?? "webview") as "webview" | "native" | "hybrid",
    apiBaseUrl: envConfig?.api_base_url ?? "",
    providers: enabledProviders,
    refreshIntervalMs: 300000, // 5 minutes
  };

  // Build env info from environment
  const envInfo = {
    name: envName,
    minSupportedAppVersion: envConfig?.min_app_version ?? "1.0.0",
    ota: {
      enabled: envConfig?.ota_enabled ?? true,
      channel: envConfig?.ota_channel ?? envName,
    },
  };

  // Build Tesla-style navigation config from categories and nav settings
  const categories = categoriesResult.data || [];
  const navSettings = navSettingsResult.data;
  
  // Group categories by group_title for drawer sections
  const categoryGroups = new Map<string, DrawerItem[]>();
  for (const cat of categories) {
    const groupTitle = (cat as any).group_title || "Other";
    if (!categoryGroups.has(groupTitle)) {
      categoryGroups.set(groupTitle, []);
    }
    categoryGroups.get(groupTitle)!.push({
      slug: (cat as any).slug,
      title: (cat as any).title,
      icon: (cat as any).icon,
      enabled: (cat as any).enabled,
      source: "db",
      providerScope: (cat as any).provider_scope || "all",
      queries: ((cat as any).queries || []) as CategoryQuery[],
    });
  }

  // Build drawer sections from category groups
  const drawerOrder = (navSettings?.drawer_order || ["Electronics", "Charging", "Vehicles", "Stores"]) as string[];
  const drawer: DrawerSection[] = [];

  for (const sectionTitle of drawerOrder) {
    if (sectionTitle === "Stores") {
      // Build Stores section from providers
      const storeItems: DrawerItem[] = catalogProviders.map(p => ({
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

  // Add remaining sections not in drawer_order
  for (const [sectionTitle, items] of categoryGroups) {
    if (!drawerOrder.includes(sectionTitle) && items.length > 0) {
      drawer.push({ sectionTitle, items });
    }
  }

  const homeSections: HomeSection[] = (navSettings?.home_sections || []) as HomeSection[];
  const catalogNavVersion = navSettings?.version || 1;

  const catalogNav: CatalogNavConfig = {
    version: catalogNavVersion,
    drawer,
    homeSections,
  };

  if (!settings) {
    console.warn("[mobile-public-config] No settings found - returning defaults");
    return {
      success: true,
      configValid: false,
      reason: "NO_SETTINGS_CONFIGURED",
      env: envName,
      catalogEnabled: catalogConfig.enabled,
      catalogMode: catalogConfig.mode,
      exchangeRate: 2500,
      markup: { type: "percent", value: 10 },
      shipping: { mode: "flat", flatUsd: 15, percentValue: 0 },
      serviceFee: { percent: 0.12, minUsd: 5 },
      limits: { maishapayMaxUsd: 5000, maishapayMaxCdf: 30000000 },
      currency: "USD",
      updated_at: new Date().toISOString(),
      version: 0,
      catalog: catalogConfig,
      catalogProviders,
      defaultProvider,
      providerUiMode,
      catalogNav,
      catalogNavVersion,
      envDetails: envInfo,
    };
  }

  const exchangeRate = settings.exchange_rate_usd_to_cdf;
  if (!exchangeRate || exchangeRate <= 0) {
    console.error("[mobile-public-config] Invalid exchange rate:", exchangeRate);
    return {
      success: true,
      configValid: false,
      reason: "MISSING_EXCHANGE_RATE",
      env: envName,
      catalogEnabled: catalogConfig.enabled,
      catalogMode: catalogConfig.mode,
      exchangeRate: 2500,
      markup: { type: "percent", value: 10 },
      shipping: { mode: "flat", flatUsd: 15, percentValue: 0 },
      serviceFee: { percent: 0.12, minUsd: 5 },
      limits: { maishapayMaxUsd: 5000, maishapayMaxCdf: 30000000 },
      currency: "USD",
      updated_at: new Date().toISOString(),
      version: 0,
      catalog: catalogConfig,
      catalogProviders,
      defaultProvider,
      providerUiMode,
      catalogNav,
      catalogNavVersion,
      envDetails: envInfo,
    };
  }

  // UNIFIED PARSING LOGIC for all percentage values
  // Database may store as decimal (0.12) or whole number (12)
  // We normalize to whole numbers: 0.12 → 12, 10 → 10
  const normalizeToWholePercent = (val: number | null | undefined, fallback: number): number => {
    const raw = val ?? fallback;
    // If value is less than 1, it's likely a decimal (0.12 = 12%)
    // Exception: values between 0.01 and 1 could be tiny percentages like 0.5%
    // Heuristic: if raw < 1 AND raw > 0, multiply by 100 to get whole number
    if (raw > 0 && raw < 1) {
      return raw * 100; // 0.12 → 12, 0.1 → 10
    }
    return raw; // Already whole number: 10 → 10, 30.2 → 30.2
  };

  // Markup: use markup_percent first, fallback to global_markup_percent
  const markupRaw = settings.markup_percent ?? settings.global_markup_percent ?? 15;
  const markupPercent = normalizeToWholePercent(markupRaw, 15);

  const categoryMarkups = (settings.category_markups || {}) as Record<string, number>;
  const vehicleMarkupRaw = categoryMarkups.vehicles;
  const vehicleMarkupPercent = vehicleMarkupRaw !== undefined 
    ? normalizeToWholePercent(vehicleMarkupRaw, markupPercent)
    : markupPercent;

  // Shipping percent - stored as whole number (10 = 10%)
  const shippingPercentRaw = settings.shipping_percent ?? 10;
  const shippingPercentValue = normalizeToWholePercent(shippingPercentRaw, 10);
  const shippingBaseFee = settings.shipping_base_fee_usd ?? 20;

  // Service fee percent - may be stored as decimal (0.12) or whole (12)
  const serviceFeeRaw = settings.service_fee_percent ?? 12;
  const serviceFeePercentValue = normalizeToWholePercent(serviceFeeRaw, 12);

  const updatedAt = settings.updated_at || new Date().toISOString();
  const version = new Date(updatedAt).getTime();

  console.log("[mobile-public-config] Parsed config:", {
    envName,
    markupRaw, markupPercent,
    vehicleMarkupRaw, vehicleMarkupPercent,
    shippingPercentRaw, shippingPercentValue, shippingBaseFee,
    serviceFeeRaw, serviceFeePercentValue,
    catalogEnabled: catalogConfig.enabled,
    catalogMode: catalogConfig.mode,
  });

  // CRITICAL: Mobile app divides by 100, so we return WHOLE NUMBERS
  // e.g., 10 means 10%, mobile does: subtotal * (10 / 100) = subtotal * 0.1
  const markupWholeNumber = Number(markupPercent);
  const vehicleMarkupWholeNumber = Number(vehicleMarkupPercent);
  // Return whole numbers - mobile divides by 100
  const shippingPercentWholeNumber = Number(shippingPercentValue);
  const serviceFeeWholeNumber = Number(serviceFeePercentValue);

  console.log("[mobile-public-config] Final output values:", {
    markupWholeNumber,
    shippingPercentWholeNumber,
    serviceFeeWholeNumber,
    note: "All percents as whole numbers (10 = 10%)"
  });

  return {
    success: true,
    configValid: true,
    // TOP-LEVEL env fields for mobile debugging
    env: envName,
    catalogEnabled: catalogConfig.enabled,
    catalogMode: catalogConfig.mode,
    // Standard config
    exchangeRate: Number(exchangeRate),
    markup: {
      type: "percent",
      value: markupWholeNumber,
      vehicleValue: vehicleMarkupWholeNumber,
    },
    shipping: {
      mode: shippingBaseFee > 0 && shippingPercentValue > 0 ? "combined" : 
            shippingBaseFee > 0 ? "flat" : "percent",
      flatUsd: Number(shippingBaseFee),
      percentValue: shippingPercentWholeNumber, // Whole number: 10 = 10%
    },
    serviceFee: {
      percent: serviceFeeWholeNumber, // Whole number: 12 = 12%
      minUsd: Number(settings.min_service_fee_usd ?? 5),
    },
    limits: {
      maishapayMaxUsd: Number(settings.maishapay_max_usd ?? 5000),
      maishapayMaxCdf: Number(settings.maishapay_max_cdf ?? 30000000),
    },
    currency: "USD",
    updated_at: updatedAt,
    version,
    catalog: catalogConfig,
    catalogProviders,
    defaultProvider,
    providerUiMode,
    catalogNav,
    catalogNavVersion,
    envDetails: envInfo,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const priority = getEndpointPriority("mobile-public-config");

  try {
    // Detect environment from request
    const envName = getEnvironmentFromRequest(req);
    const cacheKey = `public-config:${envName}`;

    const response = await withLoadShedding(priority, async () => {
      return coalesce(cacheKey, () => fetchConfig(envName), CACHE_TTL.PUBLIC_CONFIG);
    });

    console.log("[mobile-public-config] Returning config for env:", envName, "version:", response.version);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    if (err instanceof LoadSheddingError) {
      return loadSheddingResponse(err, corsHeaders);
    }

    console.error("[mobile-public-config] Error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        configValid: false,
        reason: "INTERNAL_ERROR",
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
