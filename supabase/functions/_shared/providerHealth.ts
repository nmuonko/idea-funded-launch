/**
 * Provider Health / Circuit Breaker
 * 
 * Tracks provider errors (402, 429, 5xx) in-memory and skips
 * unhealthy providers to avoid wasting time on dead calls.
 * 
 * Uses a simple time-based recovery: after cooldown, provider
 * is retried. If it fails again, cooldown doubles (exponential backoff).
 */

interface ProviderState {
  unhealthyUntil: number;   // epoch ms
  reason: string;
  lastStatusCode: number;
  consecutiveFailures: number;
  lastFailedAt: number;
}

// In-memory store (per edge function instance)
const healthStore = new Map<string, ProviderState>();

// Cooldown tiers (ms)
const BASE_COOLDOWN_MS = 10 * 60 * 1000;   // 10 minutes
const MAX_COOLDOWN_MS = 60 * 60 * 1000;    // 1 hour max

/**
 * Check if a provider is currently healthy.
 * Returns { healthy, reason, retryAfterMs } 
 */
export function isProviderHealthy(provider: string): {
  healthy: boolean;
  reason: string | null;
  retryAfterMs: number;
  statusCode: number | null;
} {
  const state = healthStore.get(provider);
  if (!state) {
    return { healthy: true, reason: null, retryAfterMs: 0, statusCode: null };
  }

  const now = Date.now();
  if (now >= state.unhealthyUntil) {
    // Cooldown expired — allow retry (but don't clear state yet;
    // recordProviderSuccess will clear it on success)
    return { healthy: true, reason: null, retryAfterMs: 0, statusCode: state.lastStatusCode };
  }

  return {
    healthy: false,
    reason: state.reason,
    retryAfterMs: state.unhealthyUntil - now,
    statusCode: state.lastStatusCode,
  };
}

/**
 * Record a provider failure. Marks it unhealthy with exponential backoff.
 * 
 * @param provider - "ebay" | "amazon"
 * @param statusCode - HTTP status code (402, 429, 500, etc.)
 * @param retryAfterSec - Optional Retry-After header value in seconds
 */
export function recordProviderFailure(
  provider: string,
  statusCode: number,
  retryAfterSec?: number,
): void {
  const now = Date.now();
  const existing = healthStore.get(provider);
  const failures = (existing?.consecutiveFailures ?? 0) + 1;

  // Determine cooldown
  let cooldownMs: number;
  if (retryAfterSec && retryAfterSec > 0) {
    // Honor Retry-After header
    cooldownMs = Math.min(retryAfterSec * 1000, MAX_COOLDOWN_MS);
  } else if (statusCode === 402) {
    // Payment/subscription issue — longer cooldown
    cooldownMs = Math.min(30 * 60 * 1000, MAX_COOLDOWN_MS); // 30 min
  } else if (statusCode === 429) {
    // Rate limit — exponential backoff
    cooldownMs = Math.min(BASE_COOLDOWN_MS * Math.pow(2, failures - 1), MAX_COOLDOWN_MS);
  } else {
    // 5xx or unknown — moderate cooldown
    cooldownMs = Math.min(5 * 60 * 1000 * failures, MAX_COOLDOWN_MS);
  }

  const reason = statusCode === 402
    ? `payment_required`
    : statusCode === 429
    ? `rate_limited`
    : `error_${statusCode}`;

  healthStore.set(provider, {
    unhealthyUntil: now + cooldownMs,
    reason,
    lastStatusCode: statusCode,
    consecutiveFailures: failures,
    lastFailedAt: now,
  });

  console.log(`[PROVIDER_HEALTH] ${provider} marked UNHEALTHY: ${reason} (status=${statusCode}, failures=${failures}, cooldown=${Math.round(cooldownMs / 1000)}s)`);
}

/**
 * Record a successful provider call. Clears unhealthy state.
 */
export function recordProviderSuccess(provider: string): void {
  if (healthStore.has(provider)) {
    console.log(`[PROVIDER_HEALTH] ${provider} recovered — marking HEALTHY`);
    healthStore.delete(provider);
  }
}

/**
 * Get health summary for all providers (for response meta).
 */
export function getProviderHealthSummary(): Record<string, {
  healthy: boolean;
  reason: string | null;
  retryAfterSec: number;
}> {
  const summary: Record<string, any> = {};
  for (const provider of ["ebay", "amazon"]) {
    const h = isProviderHealthy(provider);
    summary[provider] = {
      healthy: h.healthy,
      reason: h.reason,
      retryAfterSec: Math.ceil(h.retryAfterMs / 1000),
    };
  }
  return summary;
}
