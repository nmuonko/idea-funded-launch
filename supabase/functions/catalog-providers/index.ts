/**
 * Catalog Providers Endpoint
 * Returns list of all catalog providers with active status
 * GET /catalog-providers?env=staging
 * 
 * This is the single source of truth for provider configuration.
 * Mobile app uses this to dynamically render provider filters/tabs.
 * 
 * ALWAYS returns HTTP 200 with stable JSON shape.
 */

import { createClient } from "@supabase/supabase-js";
import { getEnvironmentFromRequest } from "../_shared/environmentResolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=300",
};

interface ProviderCapabilities {
  home?: boolean;
  search?: boolean;
  product?: boolean;
  offers?: boolean;
}

interface ProviderResponse {
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

interface CatalogProvidersResponse {
  status: "success" | "error";
  env: string;
  providers: ProviderResponse[];
  defaultProvider: string;
  providerUiMode: "tabs" | "dropdown" | "chips";
  activeCount: number;
  error: { code: string; message: string } | null;
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

function checkSecretExists(secretName: string): boolean {
  try {
    const value = Deno.env.get(secretName);
    return value !== undefined && value !== null && value.trim().length > 0;
  } catch {
    return false;
  }
}

function getRequiredSecretForProvider(provider: any): string | null {
  // Check requires_keys jsonb field first
  if (provider.requires_keys && typeof provider.requires_keys === 'object') {
    const apiKeySecret = provider.requires_keys.apiKeySecret;
    if (apiKeySecret) return apiKeySecret;
  }
  
  // Fallback to adapter_name or name mapping
  const adapterName = provider.adapter_name || provider.name;
  return PROVIDER_SECRET_MAP[adapterName] || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const envName = getEnvironmentFromRequest(req);

  const buildResponse = (
    providers: ProviderResponse[],
    error: { code: string; message: string } | null = null
  ): CatalogProvidersResponse => {
    const activeProviders = providers.filter(p => p.active);
    return {
      status: error ? "error" : "success",
      env: envName,
      providers,
      defaultProvider: activeProviders.length > 0 ? activeProviders[0].name : "all",
      providerUiMode: activeProviders.length <= 4 ? "tabs" : "dropdown",
      activeCount: activeProviders.length,
      error,
    };
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify(buildResponse([], { code: "CONFIG_ERROR", message: "Service unavailable" })), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all providers (enabled and disabled) for the environment
    const { data: providers, error: dbError } = await supabase
      .from("catalog_providers")
      .select("*")
      .or(`environment.eq.all,environment.eq.${envName}`)
      .order("priority", { ascending: false });

    if (dbError) {
      console.error("[CATALOG_PROVIDERS] Database error:", dbError.message);
      return new Response(JSON.stringify(buildResponse([], { code: "DATABASE_ERROR", message: "Failed to fetch providers" })), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Transform providers to response format
    const transformedProviders: ProviderResponse[] = (providers || []).map(provider => {
      const isEnabled = provider.enabled === true;
      
      // Check if required API key exists
      const requiredSecret = getRequiredSecretForProvider(provider);
      const hasRequiredKey = requiredSecret ? checkSecretExists(requiredSecret) : true;
      
      // Provider is active only if enabled AND has required keys
      const isActive = isEnabled && hasRequiredKey;
      
      // Determine status reason
      let statusReason: "missing_api_key" | "disabled" | null = null;
      if (!isEnabled) {
        statusReason = "disabled";
      } else if (!hasRequiredKey) {
        statusReason = "missing_api_key";
      }

      // Parse capabilities
      const capabilities: ProviderCapabilities = {
        home: provider.capabilities?.home ?? false,
        search: provider.capabilities?.search ?? false,
        product: provider.capabilities?.product ?? false,
        offers: provider.capabilities?.offers ?? false,
      };

      return {
        name: provider.name,
        displayName: provider.display_name,
        active: isActive,
        enabled: isEnabled,
        priority: provider.priority || 0,
        logoUrl: provider.logo_url || null,
        colorHex: provider.color_hex || null,
        capabilities,
        providerStatusReason: statusReason,
      };
    });

    // Sort by priority (highest first), then by active status
    transformedProviders.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.priority - a.priority;
    });

    console.log(`[CATALOG_PROVIDERS] env=${envName} total=${transformedProviders.length} active=${transformedProviders.filter(p => p.active).length} durationMs=${Date.now() - startTime}`);

    return new Response(JSON.stringify(buildResponse(transformedProviders)), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_PROVIDERS] Error: ${errorMessage}`);

    return new Response(JSON.stringify(buildResponse([], { code: "INTERNAL_ERROR", message: "Provider service error" })), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
