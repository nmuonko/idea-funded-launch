/**
 * Load Shedding Module for Graceful Degradation
 * 
 * Protects the system during viral traffic spikes by:
 * - Tracking concurrent request load
 * - Rejecting excess requests with 503 + Retry-After
 * - Prioritizing critical endpoints over non-critical
 * - Feature toggles for high-load mode
 */

// Load tracking
let currentLoad = 0;
const MAX_LOAD = 1000;  // Max concurrent requests per worker
const HIGH_LOAD_THRESHOLD = 0.7;  // 70% = high load mode
const CRITICAL_LOAD_THRESHOLD = 0.9;  // 90% = critical mode

// Request priorities
export type RequestPriority = 'critical' | 'high' | 'normal' | 'low';

const PRIORITY_LIMITS: Record<RequestPriority, number> = {
  critical: 1.0,   // Always allowed (auth, payments)
  high: 0.95,      // Almost always allowed (cart operations)
  normal: 0.80,    // Blocked at high load (user data)
  low: 0.60,       // Blocked early (AI, analytics)
};

// Feature toggles for high-load mode
interface FeatureToggles {
  aiRecommendations: boolean;
  detailedLogging: boolean;
  emailImmediately: boolean;
  fullCartRecalc: boolean;
  priceRefresh: boolean;
}

const NORMAL_FEATURES: FeatureToggles = {
  aiRecommendations: true,
  detailedLogging: true,
  emailImmediately: true,
  fullCartRecalc: true,
  priceRefresh: true,
};

const HIGH_LOAD_FEATURES: FeatureToggles = {
  aiRecommendations: false,  // Disable AI to save resources
  detailedLogging: false,    // Reduce logging overhead
  emailImmediately: false,   // Queue emails instead
  fullCartRecalc: true,      // Keep cart working
  priceRefresh: false,       // Use cached prices
};

const CRITICAL_LOAD_FEATURES: FeatureToggles = {
  aiRecommendations: false,
  detailedLogging: false,
  emailImmediately: false,
  fullCartRecalc: false,     // Use cached cart totals
  priceRefresh: false,
};

/**
 * Get current load level as a fraction (0.0 - 1.0)
 */
export function getLoadLevel(): number {
  return currentLoad / MAX_LOAD;
}

/**
 * Get current load mode
 */
export function getLoadMode(): 'normal' | 'high' | 'critical' {
  const level = getLoadLevel();
  if (level >= CRITICAL_LOAD_THRESHOLD) return 'critical';
  if (level >= HIGH_LOAD_THRESHOLD) return 'high';
  return 'normal';
}

/**
 * Get active feature toggles based on current load
 */
export function getFeatureToggles(): FeatureToggles {
  const mode = getLoadMode();
  switch (mode) {
    case 'critical': return CRITICAL_LOAD_FEATURES;
    case 'high': return HIGH_LOAD_FEATURES;
    default: return NORMAL_FEATURES;
  }
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: keyof FeatureToggles): boolean {
  return getFeatureToggles()[feature];
}

/**
 * Try to acquire a request slot
 * Returns true if allowed, false if should shed
 */
export function acquireSlot(priority: RequestPriority = 'normal'): boolean {
  const loadLevel = getLoadLevel();
  const priorityLimit = PRIORITY_LIMITS[priority];
  
  // Check if this priority level should be shed
  if (loadLevel >= priorityLimit) {
    console.log(`[LoadShedding] Shedding ${priority} request at ${Math.round(loadLevel * 100)}% load`);
    return false;
  }
  
  currentLoad++;
  return true;
}

/**
 * Release a request slot
 */
export function releaseSlot(): void {
  currentLoad = Math.max(0, currentLoad - 1);
}

/**
 * Wrap a request handler with load shedding
 */
export async function withLoadShedding<T>(
  priority: RequestPriority,
  handler: () => Promise<T>
): Promise<T> {
  if (!acquireSlot(priority)) {
    throw new LoadSheddingError(priority);
  }
  
  try {
    return await handler();
  } finally {
    releaseSlot();
  }
}

/**
 * Custom error for load shedding
 */
export class LoadSheddingError extends Error {
  public priority: RequestPriority;
  public retryAfterSeconds: number;
  
  constructor(priority: RequestPriority) {
    super(`Service overloaded. Priority ${priority} requests are being shed.`);
    this.name = 'LoadSheddingError';
    this.priority = priority;
    
    // Dynamic retry-after based on load
    const loadLevel = getLoadLevel();
    if (loadLevel >= 0.95) {
      this.retryAfterSeconds = 30;  // Very high load
    } else if (loadLevel >= 0.85) {
      this.retryAfterSeconds = 15;
    } else {
      this.retryAfterSeconds = 5;
    }
  }
}

/**
 * Create a 503 response for load shedding
 */
export function loadSheddingResponse(
  error: LoadSheddingError,
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: 'SERVICE_OVERLOADED',
      message: 'The service is temporarily overloaded. Please retry shortly.',
      retryAfter: error.retryAfterSeconds,
    }),
    {
      status: 503,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': String(error.retryAfterSeconds),
        'X-Load-Level': String(Math.round(getLoadLevel() * 100)),
      },
    }
  );
}

/**
 * Get endpoint priority based on path
 */
export function getEndpointPriority(path: string): RequestPriority {
  // Critical: Auth and payments - never shed
  if (path.includes('auth-') || 
      path.includes('payment') || 
      path.includes('checkout') ||
      path.includes('pawapay') ||
      path.includes('stripe')) {
    return 'critical';
  }
  
  // High: Cart operations - rarely shed
  if (path.includes('cart') || 
      path.includes('order') ||
      path.includes('profile')) {
    return 'high';
  }
  
  // Low: Non-essential features - shed early
  if (path.includes('ai-') || 
      path.includes('recommend') ||
      path.includes('analytics') ||
      path.includes('predict')) {
    return 'low';
  }
  
  // Normal: Everything else
  return 'normal';
}

/**
 * Get load statistics for monitoring
 */
export function getLoadStats(): {
  currentLoad: number;
  maxLoad: number;
  loadLevel: number;
  mode: string;
  features: FeatureToggles;
} {
  return {
    currentLoad,
    maxLoad: MAX_LOAD,
    loadLevel: getLoadLevel(),
    mode: getLoadMode(),
    features: getFeatureToggles(),
  };
}

/**
 * Reset load counter (for testing)
 */
export function resetLoad(): void {
  currentLoad = 0;
}
