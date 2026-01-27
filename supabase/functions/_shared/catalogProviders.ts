/**
 * Catalog Provider Interface & Types
 * Defines the contract for all product API adapters
 */

import { EnvironmentConfig, getEnvSecret } from "./environmentResolver.ts";
import { createRainforestAdapter } from "./rainforestAdapter.ts";

// ==========================================
// TYPES
// ==========================================

export interface CatalogProduct {
  id?: string;                          // Internal UUID (from cache)
  providerProductId: string;            // External product ID from provider
  providerId?: string;                  // Provider UUID
  providerName?: string;                // Provider name (amazon, walmart, etc)
  title: string;
  brand?: string;
  description?: string;
  imageUrl?: string;
  images?: string[];                    // Array of image URLs for gallery
  productUrl: string;
  priceUsd: number | null;              // null when price unavailable (NEVER 0)
  currency: string;
  inStock: boolean | null;              // null when availability unknown
  categoryPath?: string[];
  rating?: number | null;
  reviewCount?: number;
  specifications?: Record<string, string>;
  raw?: Record<string, unknown>;
}

export interface SearchFilters {
  minPrice?: number;
  maxPrice?: number;
  category?: string;
  brand?: string;
  inStockOnly?: boolean;
}

export interface SearchResult {
  products: CatalogProduct[];
  totalResults: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface Category {
  id: string;
  externalId?: string;
  name: string;
  parentId?: string;
  iconUrl?: string;
  productCount?: number;
  children?: Category[];
}

export interface ProviderConfig {
  id: string;
  name: string;
  displayName: string;
  enabled: boolean;
  priority: number;
  config: Record<string, unknown>;
  rateLimitPerMinute: number;
  environment: string;
}

// ==========================================
// PROVIDER ADAPTER INTERFACE
// ==========================================

export interface ProviderAdapter {
  name: string;
  
  /**
   * Search for products matching the query
   */
  search(
    query: string, 
    page: number, 
    filters?: SearchFilters
  ): Promise<SearchResult>;
  
  /**
   * Get a single product by its external ID
   */
  getProduct(externalId: string): Promise<CatalogProduct | null>;
  
  /**
   * Get available categories from this provider
   */
  getCategories(): Promise<Category[]>;
  
  /**
   * Check if the provider is properly configured and healthy
   */
  healthCheck(): Promise<boolean>;
}

// ==========================================
// PROVIDER REGISTRY
// ==========================================

const providerAdapters: Map<string, (config: ProviderConfig, env: EnvironmentConfig | null) => ProviderAdapter> = new Map();

/**
 * Register a provider adapter factory
 */
export function registerProvider(
  name: string,
  factory: (config: ProviderConfig, env: EnvironmentConfig | null) => ProviderAdapter
): void {
  providerAdapters.set(name, factory);
}

/**
 * Get a provider adapter instance
 */
export function getProviderAdapter(
  config: ProviderConfig,
  env: EnvironmentConfig | null
): ProviderAdapter | null {
  const factory = providerAdapters.get(config.name);
  if (!factory) {
    console.warn(`[catalogProviders] No adapter registered for provider: ${config.name}`);
    return null;
  }
  return factory(config, env);
}

// ==========================================
// REGISTER BUILT-IN ADAPTERS
// ==========================================

// Register Rainforest/Amazon adapter
registerProvider("amazon", createRainforestAdapter);

// ==========================================
// DATABASE HELPERS
// ==========================================

/**
 * Fetch enabled providers from database
 */
export async function getEnabledProviders(
  supabase: any,
  environment: string
): Promise<ProviderConfig[]> {
  const { data, error } = await supabase
    .from("catalog_providers")
    .select("*")
    .eq("enabled", true)
    .or(`environment.eq.all,environment.eq.${environment}`)
    .order("priority", { ascending: false });

  if (error) {
    console.error("[catalogProviders] Error fetching providers:", error);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    enabled: row.enabled,
    priority: row.priority,
    config: row.config || {},
    rateLimitPerMinute: row.rate_limit_per_minute,
    environment: row.environment,
  }));
}

/**
 * Check cache for products matching query
 */
export async function getCachedProducts(
  supabase: any,
  query: string,
  limit: number = 20
): Promise<CatalogProduct[]> {
  const { data, error } = await supabase
    .from("catalog_products")
    .select(`
      id,
      provider_id,
      provider_product_id,
      title,
      brand,
      description,
      image_url,
      product_url,
      price_usd,
      currency,
      in_stock,
      category_path,
      rating,
      review_count,
      raw,
      catalog_providers!inner(name)
    `)
    .textSearch("title", query, { type: "websearch" })
    .gt("expires_at", new Date().toISOString())
    .limit(limit);

  if (error) {
    console.error("[catalogProviders] Cache search error:", error);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    providerProductId: row.provider_product_id,
    providerId: row.provider_id,
    providerName: (row.catalog_providers as any)?.name,
    title: row.title || "",
    brand: row.brand,
    description: row.description,
    imageUrl: row.image_url,
    productUrl: row.product_url || "",
    priceUsd: Number(row.price_usd) || 0,
    currency: row.currency || "USD",
    inStock: row.in_stock ?? true,
    categoryPath: row.category_path,
    rating: row.rating ? Number(row.rating) : undefined,
    reviewCount: row.review_count,
    raw: row.raw,
  }));
}

/**
 * Cache a product in the database
 */
export async function cacheProduct(
  supabase: any,
  providerId: string,
  product: CatalogProduct
): Promise<void> {
  const { error } = await supabase
    .from("catalog_products")
    .upsert({
      provider_id: providerId,
      provider_product_id: product.providerProductId,
      title: product.title,
      brand: product.brand,
      description: product.description,
      image_url: product.imageUrl,
      product_url: product.productUrl,
      price_usd: product.priceUsd,
      currency: product.currency,
      in_stock: product.inStock,
      category_path: product.categoryPath,
      rating: product.rating,
      review_count: product.reviewCount,
      raw: product.raw,
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4 hours
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "provider_id,provider_product_id",
    });

  if (error) {
    console.error("[catalogProviders] Cache insert error:", error);
  }
}

/**
 * Batch cache multiple products
 */
export async function cacheProducts(
  supabase: any,
  providerId: string,
  products: CatalogProduct[]
): Promise<void> {
  if (products.length === 0) return;

  const rows = products.map((p) => ({
    provider_id: providerId,
    provider_product_id: p.providerProductId,
    title: p.title,
    brand: p.brand,
    description: p.description,
    image_url: p.imageUrl,
    product_url: p.productUrl,
    price_usd: p.priceUsd,
    currency: p.currency,
    in_stock: p.inStock,
    category_path: p.categoryPath,
    rating: p.rating,
    review_count: p.reviewCount,
    raw: p.raw,
    expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("catalog_products")
    .upsert(rows, { onConflict: "provider_id,provider_product_id" });

  if (error) {
    console.error("[catalogProviders] Batch cache error:", error);
  }
}
