/**
 * Stripe Key Resolver
 * 
 * Centralized module for resolving, validating, and logging Stripe secret keys.
 * Ensures consistent key selection across all Stripe edge functions.
 * 
 * Features:
 * - Supports explicit live/test mode selection via request param
 * - Auto-detects mode from key prefix (sk_live_ vs sk_test_)
 * - Never logs or exposes actual secret values
 * - Provides diagnostics for debugging without leaking secrets
 */

export interface StripeKeyInfo {
  secretKey: string;
  mode: 'live' | 'test';
  keyPrefix: string;        // First 8 chars only (e.g., "sk_live_")
  keyLength: number;
  isValid: boolean;
  source: 'STRIPE_SECRET_KEY' | 'STRIPE_SECRET_KEY_LIVE' | 'STRIPE_SECRET_KEY_TEST' | 'provider_config';
}

export interface StripeKeyResolutionResult {
  success: boolean;
  keyInfo?: StripeKeyInfo;
  error?: string;
  error_code?: 'STRIPE_NOT_CONFIGURED' | 'STRIPE_INVALID_KEY' | 'STRIPE_MODE_MISMATCH';
}

/**
 * Diagnostic info for logging (safe to log - no secrets)
 */
export interface StripeKeyDiagnostics {
  key_mode: 'live' | 'test' | 'unknown';
  key_present: boolean;
  key_source: string;
  key_prefix: string;
  key_length: number;
  requested_mode?: 'live' | 'test';
  timestamp: string;
}

/**
 * Resolve the appropriate Stripe secret key
 * 
 * Priority:
 * 1. If requestedMode='live' → use STRIPE_SECRET_KEY_LIVE if exists
 * 2. If requestedMode='test' → use STRIPE_SECRET_KEY_TEST if exists
 * 3. Fall back to STRIPE_SECRET_KEY and detect mode from prefix
 * 
 * @param requestedMode - Optional explicit mode request ('live' | 'test')
 * @returns StripeKeyResolutionResult with key info or error
 */
export function resolveStripeKey(requestedMode?: 'live' | 'test'): StripeKeyResolutionResult {
  let secretKey: string | undefined;
  let source: StripeKeyInfo['source'] = 'STRIPE_SECRET_KEY';

  // Try mode-specific keys first if mode is requested
  if (requestedMode === 'live') {
    secretKey = Deno.env.get('STRIPE_SECRET_KEY_LIVE');
    if (secretKey) {
      source = 'STRIPE_SECRET_KEY_LIVE';
    }
  } else if (requestedMode === 'test') {
    secretKey = Deno.env.get('STRIPE_SECRET_KEY_TEST');
    if (secretKey) {
      source = 'STRIPE_SECRET_KEY_TEST';
    }
  }

  // Fall back to generic key
  if (!secretKey) {
    secretKey = Deno.env.get('STRIPE_SECRET_KEY');
    source = 'STRIPE_SECRET_KEY';
  }

  // Check if key exists
  if (!secretKey || secretKey.trim().length === 0) {
    return {
      success: false,
      error: 'Stripe secret key is not configured in environment secrets',
      error_code: 'STRIPE_NOT_CONFIGURED',
    };
  }

  // Detect mode from key prefix
  const isTestMode = secretKey.startsWith('sk_test_');
  const isLiveMode = secretKey.startsWith('sk_live_');
  
  if (!isTestMode && !isLiveMode) {
    return {
      success: false,
      error: 'Stripe key has invalid format (should start with sk_live_ or sk_test_)',
      error_code: 'STRIPE_INVALID_KEY',
    };
  }

  const detectedMode: 'live' | 'test' = isLiveMode ? 'live' : 'test';

  // Warn if requested mode doesn't match detected mode
  if (requestedMode && requestedMode !== detectedMode) {
    console.warn('[STRIPE_KEY_RESOLVER] Mode mismatch:', {
      requestedMode,
      detectedMode,
      source,
    });
  }

  const keyInfo: StripeKeyInfo = {
    secretKey,
    mode: detectedMode,
    keyPrefix: secretKey.slice(0, 8),
    keyLength: secretKey.length,
    isValid: true,
    source,
  };

  return {
    success: true,
    keyInfo,
  };
}

/**
 * Get diagnostics info for logging (safe to log)
 */
export function getKeyDiagnostics(
  result: StripeKeyResolutionResult,
  requestedMode?: 'live' | 'test'
): StripeKeyDiagnostics {
  if (!result.success || !result.keyInfo) {
    return {
      key_mode: 'unknown',
      key_present: false,
      key_source: 'none',
      key_prefix: 'N/A',
      key_length: 0,
      requested_mode: requestedMode,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    key_mode: result.keyInfo.mode,
    key_present: true,
    key_source: result.keyInfo.source,
    key_prefix: result.keyInfo.keyPrefix,
    key_length: result.keyInfo.keyLength,
    requested_mode: requestedMode,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Log key diagnostics with standardized format
 * NEVER logs the actual secret key
 */
export function logKeyDiagnostics(
  context: string,
  diagnostics: StripeKeyDiagnostics,
  extras?: Record<string, unknown>
): void {
  console.log(`[STRIPE_BACKEND] ${context}`, {
    ...diagnostics,
    ...extras,
  });
}

/**
 * Resolve key and log diagnostics in one call
 * Returns the resolved key info or throws with error code
 */
export function resolveAndLogStripeKey(
  context: string,
  requestedMode?: 'live' | 'test',
  extras?: Record<string, unknown>
): StripeKeyResolutionResult {
  const result = resolveStripeKey(requestedMode);
  const diagnostics = getKeyDiagnostics(result, requestedMode);
  
  logKeyDiagnostics(context, diagnostics, extras);

  return result;
}

/**
 * Check if both live and test keys are configured
 */
export function checkDualKeySetup(): {
  hasLiveKey: boolean;
  hasTestKey: boolean;
  hasGenericKey: boolean;
  livekeyPrefix?: string;
  testKeyPrefix?: string;
  genericKeyPrefix?: string;
} {
  const liveKey = Deno.env.get('STRIPE_SECRET_KEY_LIVE');
  const testKey = Deno.env.get('STRIPE_SECRET_KEY_TEST');
  const genericKey = Deno.env.get('STRIPE_SECRET_KEY');

  return {
    hasLiveKey: !!liveKey && liveKey.length > 0,
    hasTestKey: !!testKey && testKey.length > 0,
    hasGenericKey: !!genericKey && genericKey.length > 0,
    livekeyPrefix: liveKey ? liveKey.slice(0, 8) : undefined,
    testKeyPrefix: testKey ? testKey.slice(0, 8) : undefined,
    genericKeyPrefix: genericKey ? genericKey.slice(0, 8) : undefined,
  };
}
