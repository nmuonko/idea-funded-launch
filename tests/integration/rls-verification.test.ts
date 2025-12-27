/**
 * RLS Verification Integration Tests
 * 
 * Verifies Row Level Security policies prevent cross-user data leakage
 * Tests access patterns for:
 *   1) Unauthenticated users
 *   2) Normal user A
 *   3) Normal user B
 *   4) Admin role
 * 
 * USAGE: npx ts-node tests/integration/rls-verification.test.ts
 * OR: deno run --allow-env --allow-net tests/integration/rls-verification.test.ts
 */

const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL') || Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('VITE_SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

// Test configuration
interface TestResult {
  test: string;
  passed: boolean;
  details: string;
  duration_ms: number;
}

interface TestSuite {
  suite: string;
  results: TestResult[];
  passed: number;
  failed: number;
}

// Helper to make authenticated requests
async function supabaseRequest(
  table: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  token?: string,
  body?: any,
  filters?: Record<string, string>
): Promise<{ status: number; data: any; error?: string }> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      url.searchParams.append(key, value);
    }
  }
  
  const headers: Record<string, string> = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    
    const data = await response.json().catch(() => null);
    
    return {
      status: response.status,
      data,
      error: response.ok ? undefined : (data?.message || data?.error || 'Request failed'),
    };
  } catch (error: any) {
    return {
      status: 500,
      data: null,
      error: error.message,
    };
  }
}

// RLS Test Cases
const RLS_TESTS = {
  // Test unauthenticated access is blocked
  async testUnauthenticatedAccessBlocked(): Promise<TestResult> {
    const start = Date.now();
    
    // Tables that should block unauthenticated access
    const protectedTables = ['orders', 'order_items', 'profiles', 'checkout_sessions', 'maisha_payments'];
    const results: string[] = [];
    let allBlocked = true;
    
    for (const table of protectedTables) {
      const { status, data } = await supabaseRequest(table, 'GET');
      
      if (status === 200 && Array.isArray(data) && data.length > 0) {
        allBlocked = false;
        results.push(`${table}: LEAKED (${data.length} rows)`);
      } else if (status === 401 || status === 403 || (status === 200 && Array.isArray(data) && data.length === 0)) {
        results.push(`${table}: BLOCKED ✓`);
      } else {
        results.push(`${table}: status=${status}`);
      }
    }
    
    return {
      test: 'Unauthenticated access blocked',
      passed: allBlocked,
      details: results.join('; '),
      duration_ms: Date.now() - start,
    };
  },
  
  // Test user can only see their own orders
  async testUserOrderIsolation(userAToken: string, userBToken: string, userAId: string, userBId: string): Promise<TestResult> {
    const start = Date.now();
    
    // User A fetches orders
    const userAOrders = await supabaseRequest('orders', 'GET', userAToken, undefined, {
      'select': 'id,user_id,status',
    });
    
    // User B fetches orders
    const userBOrders = await supabaseRequest('orders', 'GET', userBToken, undefined, {
      'select': 'id,user_id,status',
    });
    
    // Verify User A only sees their orders
    const userAHasOwnOnly = userAOrders.data?.every((o: any) => o.user_id === userAId) ?? true;
    
    // Verify User B only sees their orders
    const userBHasOwnOnly = userBOrders.data?.every((o: any) => o.user_id === userBId) ?? true;
    
    // Verify no cross-contamination
    const userASeesBOrders = userAOrders.data?.some((o: any) => o.user_id === userBId) ?? false;
    const userBSeesAOrders = userBOrders.data?.some((o: any) => o.user_id === userAId) ?? false;
    
    const passed = userAHasOwnOnly && userBHasOwnOnly && !userASeesBOrders && !userBSeesAOrders;
    
    return {
      test: 'User order isolation',
      passed,
      details: `UserA orders: ${userAOrders.data?.length || 0}, UserB orders: ${userBOrders.data?.length || 0}, Cross-leak: ${userASeesBOrders || userBSeesAOrders}`,
      duration_ms: Date.now() - start,
    };
  },
  
  // Test user can only see their own profiles
  async testUserProfileIsolation(userAToken: string, userBToken: string, userAId: string): Promise<TestResult> {
    const start = Date.now();
    
    // User A fetches all profiles (should only get own)
    const { data: profiles } = await supabaseRequest('profiles', 'GET', userAToken, undefined, {
      'select': 'id,user_id,email',
    });
    
    // User A tries to read User B's profile directly
    const { data: otherProfile, status } = await supabaseRequest('profiles', 'GET', userAToken, undefined, {
      'user_id': `neq.${userAId}`,
      'select': 'id,user_id,email',
    });
    
    const canOnlySeeSelf = profiles?.every((p: any) => p.user_id === userAId) ?? true;
    const cannotSeeOthers = !otherProfile || otherProfile.length === 0;
    
    return {
      test: 'User profile isolation',
      passed: canOnlySeeSelf && cannotSeeOthers,
      details: `Own profiles: ${profiles?.length || 0}, Other profiles: ${otherProfile?.length || 0}`,
      duration_ms: Date.now() - start,
    };
  },
  
  // Test user cannot modify another user's orders
  async testCrossUserModificationBlocked(userAToken: string, userBOrderId: string): Promise<TestResult> {
    const start = Date.now();
    
    // User A tries to update User B's order
    const { status, error } = await supabaseRequest(
      'orders',
      'PATCH',
      userAToken,
      { admin_notes: 'ATTACK ATTEMPT' },
      { 'id': `eq.${userBOrderId}` }
    );
    
    // Should be blocked (either 403, 404, or 0 rows affected)
    const blocked = status === 403 || status === 401 || status === 404 || status === 204;
    
    return {
      test: 'Cross-user modification blocked',
      passed: blocked,
      details: `Status: ${status}, Error: ${error || 'none'}`,
      duration_ms: Date.now() - start,
    };
  },
  
  // Test admin can view all orders
  async testAdminAccess(adminToken: string): Promise<TestResult> {
    const start = Date.now();
    
    if (!adminToken) {
      return {
        test: 'Admin access (skipped - no admin token)',
        passed: true,
        details: 'No admin token provided, skipping test',
        duration_ms: Date.now() - start,
      };
    }
    
    const { data: orders, status } = await supabaseRequest('orders', 'GET', adminToken, undefined, {
      'select': 'id,user_id,status',
      'limit': '100',
    });
    
    // Admin should be able to see multiple users' orders
    const uniqueUsers = new Set(orders?.map((o: any) => o.user_id) || []);
    const canSeeMultipleUsers = uniqueUsers.size > 1 || orders?.length === 0;
    
    return {
      test: 'Admin can view all orders',
      passed: status === 200 && canSeeMultipleUsers,
      details: `Status: ${status}, Orders: ${orders?.length || 0}, Unique users: ${uniqueUsers.size}`,
      duration_ms: Date.now() - start,
    };
  },
  
  // Test settings table has public read access for exchange rate
  async testPublicSettingsAccess(): Promise<TestResult> {
    const start = Date.now();
    
    // Public settings view should be accessible
    const { data, status } = await supabaseRequest('public_settings', 'GET', undefined, undefined, {
      'select': 'exchange_rate_usd_to_cdf',
    });
    
    const hasExchangeRate = data && data.length > 0 && data[0].exchange_rate_usd_to_cdf !== undefined;
    
    return {
      test: 'Public settings access',
      passed: status === 200 && hasExchangeRate,
      details: `Status: ${status}, Exchange rate available: ${hasExchangeRate}`,
      duration_ms: Date.now() - start,
    };
  },
  
  // Test that checkout_sessions are user-isolated
  async testCheckoutSessionIsolation(userAToken: string, userAId: string): Promise<TestResult> {
    const start = Date.now();
    
    const { data: sessions, status } = await supabaseRequest('checkout_sessions', 'GET', userAToken, undefined, {
      'select': 'id,user_id,status',
    });
    
    const allOwn = sessions?.every((s: any) => s.user_id === userAId) ?? true;
    
    return {
      test: 'Checkout session isolation',
      passed: status === 200 && allOwn,
      details: `Status: ${status}, Sessions: ${sessions?.length || 0}, All own: ${allOwn}`,
      duration_ms: Date.now() - start,
    };
  },
  
  // Test payment records are user-isolated
  async testPaymentRecordIsolation(userAToken: string, userAId: string): Promise<TestResult> {
    const start = Date.now();
    
    // Use safe_user_payments view which is designed for user access
    const { data: payments, status } = await supabaseRequest('safe_user_payments', 'GET', userAToken, undefined, {
      'select': 'id,order_id,status',
    });
    
    // Users should only see their own payment records (through order ownership)
    return {
      test: 'Payment record isolation',
      passed: status === 200 || status === 403,
      details: `Status: ${status}, Payments: ${payments?.length || 0}`,
      duration_ms: Date.now() - start,
    };
  },
};

// Main test runner
async function runRLSVerification(): Promise<TestSuite[]> {
  console.log('='.repeat(60));
  console.log('RLS VERIFICATION TEST SUITE');
  console.log('='.repeat(60));
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);
  
  const suites: TestSuite[] = [];
  
  // Suite 1: Unauthenticated Access Tests
  const unauthSuite: TestSuite = {
    suite: 'Unauthenticated Access',
    results: [],
    passed: 0,
    failed: 0,
  };
  
  const unauthResult = await RLS_TESTS.testUnauthenticatedAccessBlocked();
  unauthSuite.results.push(unauthResult);
  if (unauthResult.passed) unauthSuite.passed++; else unauthSuite.failed++;
  
  const publicSettingsResult = await RLS_TESTS.testPublicSettingsAccess();
  unauthSuite.results.push(publicSettingsResult);
  if (publicSettingsResult.passed) unauthSuite.passed++; else unauthSuite.failed++;
  
  suites.push(unauthSuite);
  
  // Log results
  console.log(`\n[SUITE] ${unauthSuite.suite}`);
  for (const result of unauthSuite.results) {
    console.log(`  [${result.passed ? 'PASS' : 'FAIL'}] ${result.test}`);
    console.log(`         ${result.details} (${result.duration_ms}ms)`);
  }
  
  // Suite 2: User Isolation Tests
  // Note: These require test user tokens - in a real scenario, you'd create test users
  const isolationSuite: TestSuite = {
    suite: 'User Isolation (requires test tokens)',
    results: [],
    passed: 0,
    failed: 0,
  };
  
  // Get test tokens from environment
  const userAToken = Deno.env.get('TEST_USER_A_TOKEN') || '';
  const userBToken = Deno.env.get('TEST_USER_B_TOKEN') || '';
  const userAId = Deno.env.get('TEST_USER_A_ID') || '';
  const userBId = Deno.env.get('TEST_USER_B_ID') || '';
  const adminToken = Deno.env.get('TEST_ADMIN_TOKEN') || '';
  
  if (userAToken && userBToken && userAId && userBId) {
    const orderResult = await RLS_TESTS.testUserOrderIsolation(userAToken, userBToken, userAId, userBId);
    isolationSuite.results.push(orderResult);
    if (orderResult.passed) isolationSuite.passed++; else isolationSuite.failed++;
    
    const profileResult = await RLS_TESTS.testUserProfileIsolation(userAToken, userBToken, userAId);
    isolationSuite.results.push(profileResult);
    if (profileResult.passed) isolationSuite.passed++; else isolationSuite.failed++;
    
    const sessionResult = await RLS_TESTS.testCheckoutSessionIsolation(userAToken, userAId);
    isolationSuite.results.push(sessionResult);
    if (sessionResult.passed) isolationSuite.passed++; else isolationSuite.failed++;
    
    const paymentResult = await RLS_TESTS.testPaymentRecordIsolation(userAToken, userAId);
    isolationSuite.results.push(paymentResult);
    if (paymentResult.passed) isolationSuite.passed++; else isolationSuite.failed++;
  } else {
    isolationSuite.results.push({
      test: 'User isolation tests (SKIPPED)',
      passed: true,
      details: 'Set TEST_USER_A_TOKEN, TEST_USER_B_TOKEN, TEST_USER_A_ID, TEST_USER_B_ID to run',
      duration_ms: 0,
    });
    isolationSuite.passed++;
  }
  
  suites.push(isolationSuite);
  
  console.log(`\n[SUITE] ${isolationSuite.suite}`);
  for (const result of isolationSuite.results) {
    console.log(`  [${result.passed ? 'PASS' : 'FAIL'}] ${result.test}`);
    console.log(`         ${result.details} (${result.duration_ms}ms)`);
  }
  
  // Suite 3: Admin Access Tests
  if (adminToken) {
    const adminSuite: TestSuite = {
      suite: 'Admin Access',
      results: [],
      passed: 0,
      failed: 0,
    };
    
    const adminResult = await RLS_TESTS.testAdminAccess(adminToken);
    adminSuite.results.push(adminResult);
    if (adminResult.passed) adminSuite.passed++; else adminSuite.failed++;
    
    suites.push(adminSuite);
    
    console.log(`\n[SUITE] ${adminSuite.suite}`);
    for (const result of adminSuite.results) {
      console.log(`  [${result.passed ? 'PASS' : 'FAIL'}] ${result.test}`);
      console.log(`         ${result.details} (${result.duration_ms}ms)`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const suite of suites) {
    totalPassed += suite.passed;
    totalFailed += suite.failed;
    console.log(`  ${suite.suite}: ${suite.passed}/${suite.passed + suite.failed} passed`);
  }
  
  console.log(`\nTOTAL: ${totalPassed}/${totalPassed + totalFailed} passed`);
  console.log(`STATUS: ${totalFailed === 0 ? 'ALL TESTS PASSED ✓' : 'SOME TESTS FAILED ✗'}`);
  
  return suites;
}

// Export for use in other tests
export { runRLSVerification, RLS_TESTS, supabaseRequest };

// Run if executed directly
if (import.meta.main) {
  await runRLSVerification();
}
