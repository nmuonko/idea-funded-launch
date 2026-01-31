/**
 * Home Rotation Utilities
 * 
 * Handles 12-hour rotating home feed with timebucket-based cache keys
 * that ensure content refreshes automatically every 12 hours.
 */

// ─── ROTATION KEY GENERATION ──────────────────────────────────────────────────

/**
 * Generate a rotation key based on current UTC time and rotation interval
 * Format: YYYY-MM-DD-bN where N is the bucket index (0 or 1 for 12h)
 * 
 * @param intervalMinutes - Rotation interval in minutes (default 720 = 12 hours)
 */
export function getRotationKey(intervalMinutes: number = 720): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = now.getUTCHours();
  
  // Calculate bucket based on interval
  // For 12h (720min): bucket = floor(hour / 12) → 0 or 1
  const bucketsPerDay = Math.floor(1440 / intervalMinutes);
  const bucketIndex = Math.floor(hour / (24 / bucketsPerDay));
  
  return `${year}-${month}-${day}-b${bucketIndex}`;
}

/**
 * Parse a rotation key back to its components
 */
export function parseRotationKey(key: string): { date: string; bucket: number } | null {
  const match = key.match(/^(\d{4}-\d{2}-\d{2})-b(\d+)$/);
  if (!match) return null;
  return {
    date: match[1],
    bucket: parseInt(match[2], 10),
  };
}

// ─── CACHE KEY BUILDERS ───────────────────────────────────────────────────────

/**
 * Build cache key for a home section's Amazon items
 */
export function buildHomeSectionAmazonCacheKey(sectionKey: string, rotationKey: string): string {
  return `home:${sectionKey}:${rotationKey}:amazon`;
}

/**
 * Build cache key for a home section's eBay items
 */
export function buildHomeSectionEbayCacheKey(sectionKey: string, rotationKey: string): string {
  return `home:${sectionKey}:${rotationKey}:ebay`;
}

/**
 * Build cache key for a home section's final mixed items
 */
export function buildHomeSectionMixedCacheKey(sectionKey: string, rotationKey: string): string {
  return `home:${sectionKey}:${rotationKey}:mixed`;
}

// ─── SECTION METADATA ─────────────────────────────────────────────────────────

export interface HomeSectionMetadata {
  sectionKey: string;
  rotationKey: string;
  generatedAt: string;
  amazonCount: number;
  ebayCount: number;
  mixedCount: number;
  amazonLiveUsed: boolean;
  amazonLiveReason: string;
  budgetRemaining: number | null;
}

export function buildSectionMetadata(params: {
  sectionKey: string;
  rotationKey: string;
  amazonCount: number;
  ebayCount: number;
  mixedCount: number;
  amazonLiveUsed: boolean;
  amazonLiveReason: string;
  budgetRemaining: number | null;
}): HomeSectionMetadata {
  return {
    sectionKey: params.sectionKey,
    rotationKey: params.rotationKey,
    generatedAt: new Date().toISOString(),
    amazonCount: params.amazonCount,
    ebayCount: params.ebayCount,
    mixedCount: params.mixedCount,
    amazonLiveUsed: params.amazonLiveUsed,
    amazonLiveReason: params.amazonLiveReason,
    budgetRemaining: params.budgetRemaining,
  };
}

// ─── CACHE EXPIRY CALCULATION ─────────────────────────────────────────────────

/**
 * Calculate cache expiry times based on rotation interval
 */
export function calculateCacheExpiry(ttlSeconds: number): { expiresAt: Date; staleAt: Date } {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const staleAt = new Date(now.getTime() + (ttlSeconds / 2) * 1000);
  return { expiresAt, staleAt };
}

/**
 * Check if a cache entry is still valid
 */
export function isCacheValid(expiresAt: string | Date): boolean {
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return expiry > new Date();
}
