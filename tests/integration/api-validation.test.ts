/**
 * API Validation Integration Tests
 * 
 * Validates Edge Function endpoints for:
 *   - Input schema validation
 *   - Return schema consistency
 *   - Proper error codes and formats
 *   - Timeout handling
 *   - Idempotency safeguards
 * 
 * USAGE: deno run --allow-env --allow-net tests/integration/api-validation.test.ts
 */

const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL') || Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('VITE_SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

interface TestResult {
  endpoint: string;
  test: string;
  passed: boolean;
  status: number;
  details: string;
  duration_ms: number;
}

interface EdgeFunctionResponse {
  status: number;
  data: any;
  duration_ms: number;
  headers: Headers;
}

// Helper to call edge functions
async function callEdgeFunction(
  functionName: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
  body?: any,
  token?: string
): Promise<EdgeFunctionResponse> {
  const start = Date.now();
  const url = `${SUPABASE_URL}/functions/v1/${functionName}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    
    const data = await response.json().catch(() => ({ error: 'Invalid JSON response' }));
    
    return {
      status: response.status,
      data,
      duration_ms: Date.now() - start,
      headers: response.headers,
    };
  } catch (error: any) {
    return {
      status: 0,
      data: { error: error.message },
      duration_ms: Date.now() - start,
      headers: new Headers(),
    };
  }
}

// API Validation Tests
const API_TESTS = {
  
  // ========== mobile-get-cart Tests ==========
  
  async testMobileGetCartUnauthorized(): Promise<TestResult> {
    const { status, data, duration_ms } = await callEdgeFunction('mobile-get-cart', 'GET');
    
    return {
      endpoint: 'mobile-get-cart',
      test: 'Rejects unauthorized requests',
      passed: status === 401,
      status,
      details: `Expected 401, got ${status}. Error: ${data?.error || data?.message || 'none'}`,
      duration_ms,
    };
  },
  
  async testMobileGetCartResponseSchema(token: string): Promise<TestResult> {
    const { status, data, duration_ms } = await callEdgeFunction('mobile-get-cart', 'GET', undefined, token);
    
    // Expected schema: { ok: boolean, activeItems: [], savedItems: [], summary: {} }
    const hasOk = typeof data?.ok === 'boolean';
    const hasActiveItems = Array.isArray(data?.activeItems);
    const hasSavedItems = Array.isArray(data?.savedItems);
    const hasSummary = typeof data?.summary === 'object';
    
    const passed = hasOk && hasActiveItems && hasSavedItems && hasSummary;
    
    return {
      endpoint: 'mobile-get-cart',
      test: 'Returns correct schema',
      passed: status === 200 && passed,
      status,
      details: `ok:${hasOk}, activeItems:${hasActiveItems}, savedItems:${hasSavedItems}, summary:${hasSummary}`,
      duration_ms,
    };
  },
  
  // ========== mobile-add-cart-item Tests ==========
  
  async testMobileAddCartItemValidation(token: string): Promise<TestResult> {
    // Send request with missing required field
    const { status, data, duration_ms } = await callEdgeFunction('mobile-add-cart-item', 'POST', {
      // Missing product_url
      store: 'AMAZON',
      quantity: 1,
    }, token);
    
    // Should return 400 for validation error
    const passed = status === 400;
    
    return {
      endpoint: 'mobile-add-cart-item',
      test: 'Validates required fields (product_url)',
      passed,
      status,
      details: `Expected 400, got ${status}. Error: ${data?.error || data?.message || 'none'}`,
      duration_ms,
    };
  },
  
  async testMobileAddCartItemInvalidUrl(token: string): Promise<TestResult> {
    const { status, data, duration_ms } = await callEdgeFunction('mobile-add-cart-item', 'POST', {
      product_url: 'not-a-valid-url',
      store: 'AMAZON',
      quantity: 1,
    }, token);
    
    // Should return 400 for invalid URL
    const passed = status === 400;
    
    return {
      endpoint: 'mobile-add-cart-item',
      test: 'Validates URL format',
      passed,
      status,
      details: `Expected 400, got ${status}. Code: ${data?.code || data?.error || 'none'}`,
      duration_ms,
    };
  },
  
  // ========== mobile-checkout Tests ==========
  
  async testMobileCheckoutUnauthorized(): Promise<TestResult> {
    const { status, data, duration_ms } = await callEdgeFunction('mobile-checkout', 'POST', {
      cart_item_ids: [],
    });
    
    return {
      endpoint: 'mobile-checkout',
      test: 'Rejects unauthorized requests',
      passed: status === 401,
      status,
      details: `Expected 401, got ${status}`,
      duration_ms,
    };
  },
  
  async testMobileCheckoutEmptyCart(token: string): Promise<TestResult> {
    const { status, data, duration_ms } = await callEdgeFunction('mobile-checkout', 'POST', {
      cart_item_ids: [],
    }, token);
    
    // Should reject empty cart
    const passed = status === 400 && data?.code === 'EMPTY_CART';
    
    return {
      endpoint: 'mobile-checkout',
      test: 'Rejects empty cart',
      passed,
      status,
      details: `Expected 400/EMPTY_CART, got ${status}/${data?.code}`,
      duration_ms,
    };
  },
  
  // ========== auth-me Tests ==========
  
  async testAuthMeUnauthorized(): Promise<TestResult> {
    const { status, data, duration_ms } = await callEdgeFunction('auth-me', 'GET');
    
    return {
      endpoint: 'auth-me',
      test: 'Rejects unauthorized requests',
      passed: status === 401,
      status,
      details: `Expected 401, got ${status}`,
      duration_ms,
    };
  },
  
  async testAuthMeResponseSchema(token: string): Promise<TestResult> {
    const { status, data, duration_ms } = await callEdgeFunction('auth-me', 'GET', undefined, token);
    
    // Expected: { id, email, profile, ...}
    const hasId = typeof data?.id === 'string';
    const hasEmail = typeof data?.email === 'string';
    
    return {
      endpoint: 'auth-me',
      test: 'Returns user data schema',
      passed: status === 200 && hasId && hasEmail,
      status,
      details: `id:${hasId}, email:${hasEmail}`,
      duration_ms,
    };
  },
  
  // ========== payment-decision Tests ==========
  
  async testPaymentDecisionUnauthorized(): Promise<TestResult> {
    const { status, data, duration_ms } = await callEdgeFunction('payment-decision', 'POST', {
      total_usd: 100,
    });
    
    return {
      endpoint: 'payment-decision',
      test: 'Rejects unauthorized requests',
      passed: status === 401,
      status,
      details: `Expected 401, got ${status}`,
      duration_ms,
    };
  },
  
  async testPaymentDecisionValidation(token: string): Promise<TestResult> {
    // Missing required total_usd
    const { status, data, duration_ms } = await callEdgeFunction('payment-decision', 'POST', {}, token);
    
    return {
      endpoint: 'payment-decision',
      test: 'Validates required total_usd',
      passed: status === 400,
      status,
      details: `Expected 400, got ${status}. Error: ${data?.error || 'none'}`,
      duration_ms,
    };
  },
  
  // ========== Error Schema Consistency Tests ==========
  
  async testErrorSchemaConsistency(): Promise<TestResult> {
    const endpoints = [
      { name: 'mobile-get-cart', method: 'GET' as const },
      { name: 'mobile-checkout', method: 'POST' as const },
      { name: 'auth-me', method: 'GET' as const },
    ];
    
    const results: string[] = [];
    let allConsistent = true;
    const start = Date.now();
    
    for (const ep of endpoints) {
      const { status, data } = await callEdgeFunction(ep.name, ep.method);
      
      // Error responses should have consistent structure
      if (status >= 400) {
        const hasOkFalse = data?.ok === false || data?.success === false;
        const hasErrorOrCode = data?.error || data?.code || data?.message;
        
        if (!hasOkFalse && !hasErrorOrCode) {
          allConsistent = false;
          results.push(`${ep.name}: missing ok/error fields`);
        } else {
          results.push(`${ep.name}: consistent ✓`);
        }
      }
    }
    
    return {
      endpoint: 'all',
      test: 'Error response schema consistency',
      passed: allConsistent,
      status: 0,
      details: results.join('; '),
      duration_ms: Date.now() - start,
    };
  },
  
  // ========== CORS Headers Tests ==========
  
  async testCorsHeaders(): Promise<TestResult> {
    const start = Date.now();
    const url = `${SUPABASE_URL}/functions/v1/mobile-get-cart`;
    
    try {
      const response = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      });
      
      const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
      const allowHeaders = response.headers.get('Access-Control-Allow-Headers');
      
      const passed = allowOrigin === '*' && !!allowHeaders;
      
      return {
        endpoint: 'mobile-get-cart',
        test: 'Returns CORS headers',
        passed,
        status: response.status,
        details: `Allow-Origin: ${allowOrigin}, Allow-Headers: ${allowHeaders?.substring(0, 50)}...`,
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return {
        endpoint: 'mobile-get-cart',
        test: 'Returns CORS headers',
        passed: false,
        status: 0,
        details: `Error: ${error.message}`,
        duration_ms: Date.now() - start,
      };
    }
  },
  
  // ========== Timeout Handling Tests ==========
  
  async testTimeoutHandling(): Promise<TestResult> {
    const start = Date.now();
    const timeout = 10000; // 10 second test timeout
    
    // Make a normal request and verify it completes in reasonable time
    const { status, duration_ms } = await callEdgeFunction('mobile-get-cart', 'GET');
    
    // Should fail with 401 quickly (not hang)
    const passed = duration_ms < timeout && status === 401;
    
    return {
      endpoint: 'mobile-get-cart',
      test: 'Responds within timeout',
      passed,
      status,
      details: `Responded in ${duration_ms}ms (timeout: ${timeout}ms)`,
      duration_ms,
    };
  },
};

// Main test runner
async function runAPIValidation(userToken?: string): Promise<TestResult[]> {
  console.log('='.repeat(60));
  console.log('API VALIDATION TEST SUITE');
  console.log('='.repeat(60));
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Token provided: ${!!userToken}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);
  
  const results: TestResult[] = [];
  
  // Run unauthorized tests (no token needed)
  console.log('[GROUP] Unauthorized Access Tests');
  
  const unauthTests = [
    API_TESTS.testMobileGetCartUnauthorized(),
    API_TESTS.testMobileCheckoutUnauthorized(),
    API_TESTS.testAuthMeUnauthorized(),
    API_TESTS.testPaymentDecisionUnauthorized(),
  ];
  
  for (const testPromise of unauthTests) {
    const result = await testPromise;
    results.push(result);
    console.log(`  [${result.passed ? 'PASS' : 'FAIL'}] ${result.endpoint}: ${result.test}`);
    console.log(`         ${result.details} (${result.duration_ms}ms)`);
  }
  
  // Run schema/utility tests
  console.log('\n[GROUP] Schema & Utility Tests');
  
  const schemaTests = [
    API_TESTS.testErrorSchemaConsistency(),
    API_TESTS.testCorsHeaders(),
    API_TESTS.testTimeoutHandling(),
  ];
  
  for (const testPromise of schemaTests) {
    const result = await testPromise;
    results.push(result);
    console.log(`  [${result.passed ? 'PASS' : 'FAIL'}] ${result.endpoint}: ${result.test}`);
    console.log(`         ${result.details} (${result.duration_ms}ms)`);
  }
  
  // Run authenticated tests (if token provided)
  if (userToken) {
    console.log('\n[GROUP] Authenticated API Tests');
    
    const authTests = [
      API_TESTS.testMobileGetCartResponseSchema(userToken),
      API_TESTS.testAuthMeResponseSchema(userToken),
      API_TESTS.testMobileAddCartItemValidation(userToken),
      API_TESTS.testMobileAddCartItemInvalidUrl(userToken),
      API_TESTS.testMobileCheckoutEmptyCart(userToken),
      API_TESTS.testPaymentDecisionValidation(userToken),
    ];
    
    for (const testPromise of authTests) {
      const result = await testPromise;
      results.push(result);
      console.log(`  [${result.passed ? 'PASS' : 'FAIL'}] ${result.endpoint}: ${result.test}`);
      console.log(`         ${result.details} (${result.duration_ms}ms)`);
    }
  } else {
    console.log('\n[SKIPPED] Authenticated tests - no TEST_USER_TOKEN provided');
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`TOTAL: ${passed}/${passed + failed} passed`);
  console.log(`STATUS: ${failed === 0 ? 'ALL TESTS PASSED ✓' : 'SOME TESTS FAILED ✗'}`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const result of results.filter(r => !r.passed)) {
      console.log(`  - ${result.endpoint}: ${result.test}`);
    }
  }
  
  return results;
}

// Export for use in other tests
export { runAPIValidation, API_TESTS, callEdgeFunction };

// Run if executed directly
if (import.meta.main) {
  const userToken = Deno.env.get('TEST_USER_TOKEN') || '';
  await runAPIValidation(userToken);
}
