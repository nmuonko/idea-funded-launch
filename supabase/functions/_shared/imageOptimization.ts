/**
 * Image Optimization Utilities
 * Ensures all catalog images use highest available resolution
 * 
 * This module provides:
 * 1. eBay image URL upgrading (s-l### → s-l1600)
 * 2. Amazon/Rainforest image sorting by resolution
 * 3. Dev logging for image selection decisions
 * 4. Thumbnail detection to avoid blurry images
 */

// Dev mode check
const IS_DEV = Deno.env.get("DENO_DEPLOYMENT_ID")?.includes("staging") ||
               Deno.env.get("ENV") === "development" ||
               Deno.env.get("NODE_ENV") === "development";

/**
 * Log image decisions (only in dev/staging)
 */
function devLog(marker: string, data: Record<string, unknown>): void {
  if (IS_DEV) {
    console.log(`[${marker}]`, JSON.stringify(data));
  }
}

// ─── eBay Image Optimization ─────────────────────────────────────────────────

/**
 * eBay thumbnail size patterns that indicate low resolution
 * These should be upgraded to s-l1600
 */
const EBAY_LOW_RES_PATTERNS = [
  /s-l64\b/i,
  /s-l96\b/i,
  /s-l140\b/i,
  /s-l200\b/i,
  /s-l225\b/i,
  /s-l300\b/i,
  /s-l400\b/i,
  /s-l500\b/i,
];

/**
 * Check if eBay URL is a low-resolution thumbnail
 */
export function isEbayThumbnail(url: string): boolean {
  return EBAY_LOW_RES_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Upgrade eBay image URL to highest resolution (s-l1600)
 * eBay uses s-l### pattern where ### is the size (64, 140, 225, 300, 500, 1600)
 * 
 * @param url - eBay image URL
 * @returns Upgraded URL with s-l1600
 */
export function upgradeEbayImageToHighRes(url: string): string {
  if (!url || typeof url !== "string") return url;
  
  const wasThumbnail = isEbayThumbnail(url);
  const upgraded = url.replace(/s-l\d+/gi, "s-l1600");
  
  if (wasThumbnail && IS_DEV) {
    devLog("EBAY_IMAGE_UPGRADED", {
      from: url.substring(0, 80),
      to: upgraded.substring(0, 80),
    });
  }
  
  return upgraded;
}

/**
 * Select the best main image URL from eBay item data
 * Priority: image.imageUrl > additionalImages[0] > thumbnailImages[0]
 * All URLs are upgraded to s-l1600
 */
export function selectBestEbayImage(item: Record<string, unknown>): string | null {
  const candidates: Array<{ url: string; source: string; priority: number }> = [];
  
  // Priority 1: Primary image field
  const primaryImage = item.image as Record<string, unknown> | undefined;
  if (primaryImage?.imageUrl && typeof primaryImage.imageUrl === "string") {
    candidates.push({
      url: primaryImage.imageUrl,
      source: "image.imageUrl",
      priority: 1,
    });
  }
  
  // Priority 2: Additional images
  const additionalImages = item.additionalImages as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(additionalImages)) {
    for (let i = 0; i < Math.min(additionalImages.length, 3); i++) {
      const imgUrl = additionalImages[i]?.imageUrl;
      if (imgUrl && typeof imgUrl === "string") {
        candidates.push({
          url: imgUrl,
          source: `additionalImages[${i}]`,
          priority: 2 + i,
        });
      }
    }
  }
  
  // Priority 3: Thumbnail images (lowest priority, only if nothing else)
  const thumbnailImages = item.thumbnailImages as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(thumbnailImages)) {
    for (let i = 0; i < Math.min(thumbnailImages.length, 2); i++) {
      const imgUrl = thumbnailImages[i]?.imageUrl;
      if (imgUrl && typeof imgUrl === "string") {
        candidates.push({
          url: imgUrl,
          source: `thumbnailImages[${i}]`,
          priority: 10 + i,
        });
      }
    }
  }
  
  if (candidates.length === 0) {
    devLog("EBAY_NO_IMAGE", { itemId: item.itemId });
    return null;
  }
  
  // Sort by priority and pick the best
  candidates.sort((a, b) => a.priority - b.priority);
  const best = candidates[0];
  const upgradedUrl = upgradeEbayImageToHighRes(best.url);
  
  devLog("EBAY_IMAGE_SELECTED", {
    itemId: item.itemId,
    source: best.source,
    wasThumbnail: isEbayThumbnail(best.url),
    upgraded: best.url !== upgradedUrl,
    url: upgradedUrl.substring(0, 80),
  });
  
  return upgradedUrl;
}

/**
 * Extract and upgrade all images from eBay item for list views
 * Returns array of high-res URLs, limited to specified count
 */
export function extractEbayImagesForList(item: Record<string, unknown>, maxCount: number = 2): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  
  const addImage = (url: string | undefined) => {
    if (!url || typeof url !== "string" || images.length >= maxCount) return;
    const upgraded = upgradeEbayImageToHighRes(url);
    if (!seen.has(upgraded)) {
      seen.add(upgraded);
      images.push(upgraded);
    }
  };
  
  // Primary image first
  const primaryImage = item.image as Record<string, unknown> | undefined;
  if (primaryImage?.imageUrl) {
    addImage(primaryImage.imageUrl as string);
  }
  
  // Additional images
  const additionalImages = item.additionalImages as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(additionalImages)) {
    for (const img of additionalImages) {
      addImage(img?.imageUrl as string);
    }
  }
  
  // Fallback to thumbnails only if nothing else
  if (images.length === 0) {
    const thumbnailImages = item.thumbnailImages as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(thumbnailImages)) {
      for (const img of thumbnailImages) {
        addImage(img?.imageUrl as string);
      }
    }
  }
  
  return images;
}

// ─── Amazon/Rainforest Image Optimization ────────────────────────────────────

/**
 * Amazon thumbnail patterns that indicate low resolution
 */
const AMAZON_THUMBNAIL_PATTERNS = [
  /_SS\d{2,3}\./i,   // _SS40., _SS100.
  /_SX\d{2,3}\./i,   // _SX50., _SX200.
  /_SY\d{2,3}\./i,   // _SY75., _SY160.
  /_AC_U[SL]\d{2,3}/i, // _AC_US40, _AC_UL100
  /_SR\d+,\d+\./i,   // _SR38,50.
  /_CB\d+\./i,       // Some low-res variants
];

/**
 * Check if Amazon URL is a low-resolution thumbnail
 */
export function isAmazonThumbnail(url: string): boolean {
  return AMAZON_THUMBNAIL_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Estimate resolution from Amazon URL pattern
 * Higher number = higher resolution
 */
function estimateAmazonResolution(url: string): number {
  if (!url) return 0;
  
  // High-res indicators (highest priority)
  if (url.includes("_SL1500") || url.includes("_SL1600")) return 1600;
  if (url.includes("_SL1200")) return 1200;
  if (url.includes("_SL1000")) return 1000;
  
  // Medium resolution
  if (url.includes("_SL800") || url.includes("_SX800") || url.includes("_SY800")) return 800;
  if (url.includes("_SL500") || url.includes("_SX500") || url.includes("_SY500")) return 500;
  
  // Extract numeric size from URL patterns
  const sizeMatch = url.match(/_S[XYL](\d{3,4})/i);
  if (sizeMatch) return parseInt(sizeMatch[1], 10);
  
  // Low-res patterns
  if (isAmazonThumbnail(url)) return 100;
  
  // Default medium if no pattern matched but URL exists
  return 400;
}

/**
 * Upgrade Amazon image URL to high resolution
 * Attempts to modify size tokens in URL
 */
export function upgradeAmazonImageToHighRes(url: string): string {
  if (!url || typeof url !== "string") return url;
  
  // Already high-res
  if (url.includes("_SL1500") || url.includes("_SL1600")) return url;
  
  let upgraded = url;
  
  // Replace common size patterns with high-res versions
  upgraded = upgraded.replace(/_S[XYL]\d{2,3}\./gi, "_SL1500.");
  upgraded = upgraded.replace(/_SS\d{2,3}\./gi, "_SL1500.");
  upgraded = upgraded.replace(/_AC_U[SL]\d{2,3}/gi, "_AC_SL1500");
  upgraded = upgraded.replace(/_SR\d+,\d+\./gi, "_SL1500.");
  
  if (upgraded !== url && IS_DEV) {
    devLog("AMAZON_IMAGE_UPGRADED", {
      from: url.substring(0, 80),
      to: upgraded.substring(0, 80),
    });
  }
  
  return upgraded;
}

/**
 * Select the best main image from Amazon/Rainforest product data
 * Considers: main_image > images[0] sorted by resolution > image field
 * Never returns thumbnail variants for main display
 */
export function selectBestAmazonImage(product: Record<string, unknown>): string | null {
  const candidates: Array<{ url: string; source: string; resolution: number }> = [];
  
  // Check main_image field (highest priority)
  if (product.main_image) {
    const mainImg = product.main_image;
    const url = typeof mainImg === "string" ? mainImg : (mainImg as Record<string, string>)?.link;
    if (url) {
      candidates.push({
        url,
        source: "main_image",
        resolution: estimateAmazonResolution(url) + 1000, // Boost main_image priority
      });
    }
  }
  
  // Check images array
  const images = product.images as Array<unknown> | undefined;
  if (Array.isArray(images)) {
    for (let i = 0; i < Math.min(images.length, 5); i++) {
      const img = images[i];
      let url: string | null = null;
      
      if (typeof img === "string") {
        url = img;
      } else if (img && typeof img === "object") {
        const imgObj = img as Record<string, unknown>;
        // Prefer high-res variants
        url = (imgObj.large || imgObj.hi_res || imgObj.link || imgObj.url || imgObj.src) as string | null;
      }
      
      if (url) {
        candidates.push({
          url,
          source: `images[${i}]`,
          resolution: estimateAmazonResolution(url),
        });
      }
    }
  }
  
  // Check hi_res_images if available
  const hiResImages = product.hi_res_images as Array<unknown> | undefined;
  if (Array.isArray(hiResImages)) {
    for (let i = 0; i < Math.min(hiResImages.length, 3); i++) {
      const img = hiResImages[i];
      const url = typeof img === "string" ? img : (img as Record<string, string>)?.link;
      if (url) {
        candidates.push({
          url,
          source: `hi_res_images[${i}]`,
          resolution: estimateAmazonResolution(url) + 500, // Boost hi-res priority
        });
      }
    }
  }
  
  // Fallback: single image field
  if (product.image && typeof product.image === "string") {
    candidates.push({
      url: product.image,
      source: "image",
      resolution: estimateAmazonResolution(product.image),
    });
  }
  
  // Fallback: thumbnail (lowest priority)
  if (product.thumbnail) {
    const thumbUrl = typeof product.thumbnail === "string" 
      ? product.thumbnail 
      : (product.thumbnail as Record<string, string>)?.link;
    if (thumbUrl) {
      candidates.push({
        url: thumbUrl,
        source: "thumbnail",
        resolution: 50, // Very low priority
      });
    }
  }
  
  if (candidates.length === 0) {
    devLog("AMAZON_NO_IMAGE", { asin: product.asin });
    return null;
  }
  
  // Sort by resolution (highest first)
  candidates.sort((a, b) => b.resolution - a.resolution);
  const best = candidates[0];
  const upgradedUrl = upgradeAmazonImageToHighRes(best.url);
  
  devLog("AMAZON_IMAGE_SELECTED", {
    asin: product.asin,
    source: best.source,
    resolution: best.resolution,
    wasThumbnail: isAmazonThumbnail(best.url),
    upgraded: best.url !== upgradedUrl,
    url: upgradedUrl.substring(0, 80),
  });
  
  return upgradedUrl;
}

/**
 * Extract and sort images from Amazon product for list views
 * Returns array with best resolution images first, limited to specified count
 */
export function extractAmazonImagesForList(product: Record<string, unknown>, maxCount: number = 2): string[] {
  const seen = new Set<string>();
  const candidates: Array<{ url: string; resolution: number }> = [];
  
  const addCandidate = (url: string | undefined | null) => {
    if (!url || typeof url !== "string") return;
    const upgraded = upgradeAmazonImageToHighRes(url);
    if (!seen.has(upgraded)) {
      seen.add(upgraded);
      candidates.push({
        url: upgraded,
        resolution: estimateAmazonResolution(url),
      });
    }
  };
  
  // Collect from all sources
  const mainImg = product.main_image;
  if (mainImg) {
    addCandidate(typeof mainImg === "string" ? mainImg : (mainImg as Record<string, string>)?.link);
  }
  
  const images = product.images as Array<unknown> | undefined;
  if (Array.isArray(images)) {
    for (const img of images.slice(0, 5)) {
      if (typeof img === "string") {
        addCandidate(img);
      } else if (img && typeof img === "object") {
        const imgObj = img as Record<string, unknown>;
        addCandidate((imgObj.large || imgObj.hi_res || imgObj.link || imgObj.url) as string);
      }
    }
  }
  
  if (product.image && typeof product.image === "string") {
    addCandidate(product.image);
  }
  
  // Sort by resolution and take top N
  candidates.sort((a, b) => b.resolution - a.resolution);
  return candidates.slice(0, maxCount).map(c => c.url);
}

// ─── Generic Helpers ─────────────────────────────────────────────────────────

/**
 * Check if any image URL looks like a thumbnail
 */
export function detectThumbnail(url: string): { isThumbnail: boolean; provider: string | null } {
  if (!url) return { isThumbnail: false, provider: null };
  
  if (url.includes("ebayimg.com") || url.includes("i.ebayimg")) {
    return { isThumbnail: isEbayThumbnail(url), provider: "ebay" };
  }
  
  if (url.includes("amazon") || url.includes("media-amazon") || url.includes("ssl-images-amazon")) {
    return { isThumbnail: isAmazonThumbnail(url), provider: "amazon" };
  }
  
  return { isThumbnail: false, provider: null };
}

/**
 * Upgrade any supported image URL to high resolution
 */
export function upgradeToHighRes(url: string): string {
  if (!url) return url;
  
  if (url.includes("ebayimg.com") || url.includes("i.ebayimg")) {
    return upgradeEbayImageToHighRes(url);
  }
  
  if (url.includes("amazon") || url.includes("media-amazon") || url.includes("ssl-images-amazon")) {
    return upgradeAmazonImageToHighRes(url);
  }
  
  return url;
}
