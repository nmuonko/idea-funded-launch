/**
 * Circuit Breaker Pattern for External Services
 * 
 * Protects against cascading failures during viral traffic spikes.
 * When an external service fails repeatedly, the circuit "opens"
 * and rejects requests immediately instead of waiting for timeouts.
 */

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitConfig {
  failureThreshold: number;      // Failures before opening
  recoveryTimeMs: number;        // Time before trying again
  halfOpenRequests: number;      // Test requests in half-open state
  timeoutMs: number;             // Request timeout
}

interface CircuitStatus {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  successesSinceHalfOpen: number;
}

// Circuit states for different services
const circuits = new Map<string, CircuitStatus>();

// Default configuration
const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  recoveryTimeMs: 30_000,        // 30 seconds
  halfOpenRequests: 3,
  timeoutMs: 10_000,             // 10 seconds
};

// Service-specific configurations
const SERVICE_CONFIGS: Record<string, Partial<CircuitConfig>> = {
  'pawapay': {
    failureThreshold: 3,
    recoveryTimeMs: 60_000,      // 1 minute - payment critical
    timeoutMs: 15_000,
  },
  'stripe': {
    failureThreshold: 3,
    recoveryTimeMs: 60_000,
    timeoutMs: 15_000,
  },
  'resend': {
    failureThreshold: 5,
    recoveryTimeMs: 30_000,
    timeoutMs: 10_000,
  },
  'openai': {
    failureThreshold: 5,
    recoveryTimeMs: 30_000,
    timeoutMs: 30_000,           // AI can be slow
  },
};

function getConfig(service: string): CircuitConfig {
  const serviceConfig = SERVICE_CONFIGS[service] || {};
  return { ...DEFAULT_CONFIG, ...serviceConfig };
}

function getCircuit(service: string): CircuitStatus {
  if (!circuits.has(service)) {
    circuits.set(service, {
      state: 'CLOSED',
      failures: 0,
      lastFailure: 0,
      successesSinceHalfOpen: 0,
    });
  }
  return circuits.get(service)!;
}

/**
 * Check if a request to a service is allowed
 */
export function canCall(service: string): boolean {
  const circuit = getCircuit(service);
  const config = getConfig(service);
  
  switch (circuit.state) {
    case 'CLOSED':
      return true;
      
    case 'OPEN':
      // Check if recovery time has passed
      if (Date.now() - circuit.lastFailure >= config.recoveryTimeMs) {
        // Transition to half-open
        circuit.state = 'HALF_OPEN';
        circuit.successesSinceHalfOpen = 0;
        console.log(`[CircuitBreaker] ${service}: OPEN -> HALF_OPEN`);
        return true;
      }
      return false;
      
    case 'HALF_OPEN':
      // Allow limited test requests
      return true;
  }
}

/**
 * Record a successful call
 */
export function recordSuccess(service: string): void {
  const circuit = getCircuit(service);
  const config = getConfig(service);
  
  if (circuit.state === 'HALF_OPEN') {
    circuit.successesSinceHalfOpen++;
    
    // If enough successes, close the circuit
    if (circuit.successesSinceHalfOpen >= config.halfOpenRequests) {
      circuit.state = 'CLOSED';
      circuit.failures = 0;
      console.log(`[CircuitBreaker] ${service}: HALF_OPEN -> CLOSED (recovered)`);
    }
  } else if (circuit.state === 'CLOSED') {
    // Reset failure count on success
    circuit.failures = Math.max(0, circuit.failures - 1);
  }
}

/**
 * Record a failed call
 */
export function recordFailure(service: string, error?: string): void {
  const circuit = getCircuit(service);
  const config = getConfig(service);
  
  circuit.failures++;
  circuit.lastFailure = Date.now();
  
  if (circuit.state === 'HALF_OPEN') {
    // Any failure in half-open reopens the circuit
    circuit.state = 'OPEN';
    console.log(`[CircuitBreaker] ${service}: HALF_OPEN -> OPEN (test failed: ${error || 'unknown'})`);
  } else if (circuit.state === 'CLOSED' && circuit.failures >= config.failureThreshold) {
    // Too many failures, open the circuit
    circuit.state = 'OPEN';
    console.log(`[CircuitBreaker] ${service}: CLOSED -> OPEN (${circuit.failures} failures)`);
  }
}

/**
 * Get current circuit state for a service
 */
export function getCircuitState(service: string): {
  state: CircuitState;
  failures: number;
  isAvailable: boolean;
  nextRetryIn?: number;
} {
  const circuit = getCircuit(service);
  const config = getConfig(service);
  const isAvailable = canCall(service);
  
  let nextRetryIn: number | undefined;
  if (circuit.state === 'OPEN') {
    const elapsed = Date.now() - circuit.lastFailure;
    nextRetryIn = Math.max(0, config.recoveryTimeMs - elapsed);
  }
  
  return {
    state: circuit.state,
    failures: circuit.failures,
    isAvailable,
    nextRetryIn,
  };
}

/**
 * Execute a function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>
): Promise<T> {
  if (!canCall(service)) {
    const state = getCircuitState(service);
    console.log(`[CircuitBreaker] ${service} is OPEN, rejecting request. Retry in ${state.nextRetryIn}ms`);
    
    if (fallback) {
      return fallback();
    }
    
    throw new Error(`Service ${service} is temporarily unavailable. Circuit is OPEN.`);
  }
  
  const config = getConfig(service);
  
  try {
    // Add timeout protection
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${service} request timeout after ${config.timeoutMs}ms`)), config.timeoutMs)
      ),
    ]);
    
    recordSuccess(service);
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    recordFailure(service, errorMsg);
    throw error;
  }
}

/**
 * Reset a circuit to closed state (for testing/admin)
 */
export function resetCircuit(service: string): void {
  circuits.set(service, {
    state: 'CLOSED',
    failures: 0,
    lastFailure: 0,
    successesSinceHalfOpen: 0,
  });
  console.log(`[CircuitBreaker] ${service}: Reset to CLOSED`);
}

/**
 * Get all circuit statuses for monitoring
 */
export function getAllCircuitStates(): Record<string, ReturnType<typeof getCircuitState>> {
  const result: Record<string, ReturnType<typeof getCircuitState>> = {};
  
  // Include all known services, even if no circuit exists yet
  const allServices = [...Object.keys(SERVICE_CONFIGS), ...circuits.keys()];
  const uniqueServices = [...new Set(allServices)];
  
  for (const service of uniqueServices) {
    result[service] = getCircuitState(service);
  }
  
  return result;
}
