/**
 * Catalog Item Mappers - Shared across catalog-search and catalog-category
 * Converts normalized items and DB records to response format
 */

import type { NormalizedItem } from "./ebayBrowseSearch.ts";
import { upgradeEbayImage, upgradeAmazonImage } from "./imageUpgrade.ts";

export interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string | null;
  priceUsd: number | null;
  currency: string;
  mainImageUrl: string | null;
  imageUrl: string | null;
  images: string[];
  imageUrls: string[];
  imageCount: number;
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  condition?: string;
  shippingPrice?: number | null;
  location?: string | null;
  category?: string;
  subcategory?: string;
}

/**
 * Map eBay normalized item to response format
 */
export function mapEbayItemToResponse(item: NormalizedItem): CatalogItem {
  const metadata = item.metadata || {};
  // Upgrade eBay images to high-res
  const rawMainImage = item.image_url || (item.image_urls?.length > 0 ? item.image_urls[0] : null);
  const mainImage = upgradeEbayImage(rawMainImage);
  const imagesArray = item.images || item.image_urls || [];
  
  return {
    id: item.id,
    provider: "ebay",
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    currency: item.currency,
    mainImageUrl: mainImage,
    imageUrl: mainImage,  // Backward compat
    images: imagesArray,
    imageUrls: imagesArray,
    imageCount: item.image_count || imagesArray.length || 1,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    condition: (metadata.condition as string) || undefined,
    shippingPrice: (metadata.shipping_price as number) || null,
    location: (metadata.location as string) || null,
  };
}

/**
 * Map database item to response format
 */
export function mapDbItemToResponse(item: Record<string, unknown>): CatalogItem {
  const provider = (item.provider as string) || "amazon";
  
  // For list views, only return single main image
  let rawImageUrl = item.image_url as string | null;
  
  // Get full images array
  const imagesArray = Array.isArray(item.images) ? item.images as string[] : [];
  if (!rawImageUrl && imagesArray.length > 0) {
    rawImageUrl = imagesArray[0] as string;
  }
  
  // Upgrade to high-res based on provider
  let mainImage: string | null = rawImageUrl;
  if (rawImageUrl) {
    if (provider === "rainforest" || provider === "amazon") {
      mainImage = upgradeAmazonImage(rawImageUrl);
    } else if (provider === "ebay") {
      mainImage = upgradeEbayImage(rawImageUrl);
    } else if (provider === "shein") {
      // SHEIN images from img.ltwebstatic.com are already high-res
      mainImage = rawImageUrl;
    }
  }
  
  // Compute image count from stored images array or default to 1
  const imageCount = imagesArray.length > 0 ? imagesArray.length : 1;
  
  return {
    id: item.id as string,
    provider,
    providerProductId: item.provider_product_id as string,
    title: item.title as string | null,
    priceUsd: item.price_usd as number | null,
    currency: "USD",
    mainImageUrl: mainImage,
    imageUrl: mainImage,  // Backward compat
    images: imagesArray,
    imageUrls: imagesArray,
    imageCount,           // Total images available
    productUrl: item.product_url as string | null,
    inStock: item.in_stock as boolean | null,
    rating: item.rating as number | null,
    category: item.unified_category as string | undefined,
    subcategory: item.unified_subcategory as string | undefined,
  };
}

/**
 * Map Amazon/Rainforest product to catalog item
 */
export function mapRainforestProduct(
  product: {
    providerProductId: string;
    title: string | null;
    priceUsd: number | null;
    imageUrl: string | null;
    images?: string[];
    imageCount?: number;
    productUrl: string | null;
    inStock?: boolean;
    rating: number | null;
  },
  categoryKey?: string
): CatalogItem {
  const mainImage = upgradeAmazonImage(product.imageUrl);
  const images = (product.images && Array.isArray(product.images) && product.images.length > 0) 
    ? product.images 
    : (product.imageUrl ? [product.imageUrl] : []);
  
  return {
    id: `amazon_${product.providerProductId}`,
    provider: "rainforest",
    providerProductId: product.providerProductId,
    title: product.title,
    priceUsd: product.priceUsd,
    currency: "USD",
    mainImageUrl: mainImage,
    imageUrl: mainImage,
    images,
    imageUrls: images,
    imageCount: product.imageCount || images.length || 1,
    productUrl: product.productUrl,
    inStock: product.inStock ?? true,
    rating: product.rating,
    category: categoryKey || undefined,
  };
}
