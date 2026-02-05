/**
 * Image URL Upgrade Module
 * 
 * Utility functions to upgrade image URLs to higher resolution versions
 */

/**
 * Upgrade eBay image URL to highest resolution (s-l1600)
 * eBay uses s-l### pattern where ### is the size (64, 140, 225, 300, 500, 1600)
 */
export function upgradeEbayImage(url: string | null): string | null {
  if (!url) return null;
  const wasThumbnail = /s-l(64|96|140|200|225|300|400|500)\b/i.test(url);
  const upgraded = url.replace(/s-l\d+/gi, "s-l1600");
  if (wasThumbnail) {
    console.log("[EBAY_IMAGE_UPGRADE]", JSON.stringify({
      original: url.substring(0, 60),
      upgraded: upgraded.substring(0, 60),
    }));
  }
  return upgraded;
}

/**
 * Upgrade Amazon image URL to highest resolution
 * Amazon uses various size tokens: _SX###, _SY###, _AC_US###, etc.
 */
export function upgradeAmazonImage(url: string | null): string | null {
  if (!url) return null;
  
  // Already high-res
  if (url.includes("_SL1500") || url.includes("_SL1600")) return url;
  
  // Detect thumbnail patterns
  const THUMBNAIL_PATTERNS = [
    /_SS\d{2,3}\./i,
    /_SX\d{2,3}\./i,
    /_SY\d{2,3}\./i,
    /_AC_U[SY]\d{2,3}/i,
    /_SR\d+,\d+\./i,
  ];
  
  const wasThumbnail = THUMBNAIL_PATTERNS.some(p => p.test(url));
  
  // Upgrade size tokens
  let upgraded = url
    .replace(/_S[XYL]\d{2,3}\./gi, "_SL1500.")
    .replace(/_SS\d{2,3}\./gi, "_SL1500.")
    .replace(/_AC_U[SYL]\d{2,3}/gi, "_AC_SL1500")
    .replace(/_SR\d+,\d+\./gi, "_SL1500.");
  
  if (wasThumbnail) {
    console.log("[AMAZON_IMAGE_UPGRADE]", JSON.stringify({
      original: url.substring(0, 60),
      upgraded: upgraded.substring(0, 60),
    }));
  }
  
  return upgraded;
}

/**
 * Upgrade image URL based on provider
 */
export function upgradeImageByProvider(url: string | null, provider: string): string | null {
  if (!url) return null;
  
  if (provider === "rainforest" || provider === "amazon") {
    return upgradeAmazonImage(url);
  } else if (provider === "ebay") {
    return upgradeEbayImage(url);
  }
  
  return url;
}
