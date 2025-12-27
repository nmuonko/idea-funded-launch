/**
 * k6 Load Test: Full User Journey
 * 
 * Simulates complete user journeys with realistic operation mix:
 *   - 60% browse/read (cart fetch, auth)
 *   - 25% cart mutations (add, update, delete)
 *   - 10% checkout initialization
 *   - 5% order status checks
 * 
 * USAGE: k6 run --env BASE_URL=https://... --env TEST_TOKEN=... tests/load/k6/full_user_journey.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const cartFetchTime = new Trend('cart_fetch_time', true);
const authCheckTime = new Trend('auth_check_time', true);
const cartMutationTime = new Trend('cart_mutation_time', true);
const checkoutTime = new Trend('checkout_time', true);
const orderStatusTime = new Trend('order_status_time', true);

const successfulOps = new Counter('successful_operations');
const failedOps = new Counter('failed_operations');
const activeUsers = new Gauge('active_users');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1';
const TEST_TOKEN = __ENV.TEST_TOKEN || '';
const ANON_KEY = __ENV.ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbWtoeGZmbnl6b29nY3F2ZGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMzM2NjYsImV4cCI6MjA3OTcwOTY2Nn0.xMa-K25tL63StMYRZDq7xovDPyrWlB_LA-KkGciqZaA';

// Full user journey test - main load test scenario
export const options = {
  scenarios: {
    // Baseline: steady load
    steady_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: parseInt(__ENV.VUS) || 100 },   // Ramp to 100 VUs
        { duration: __ENV.DURATION || '6m', target: parseInt(__ENV.VUS) || 100 }, // Steady
        { duration: '2m', target: 0 },                             // Ramp down
      ],
      gracefulRampDown: '30s',
      tags: { scenario: 'steady_load' },
    },
    // Spike test: sudden traffic increase
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 20 },      // Warmup
        { duration: '30s', target: 200 },    // Spike to 200
        { duration: '1m', target: 200 },     // Hold spike
        { duration: '30s', target: 20 },     // Back down
        { duration: '1m', target: 20 },      // Steady
        { duration: '30s', target: 0 },      // Ramp down
      ],
      startTime: '5m',
      gracefulRampDown: '30s',
      tags: { scenario: 'spike_test' },
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<1500', 'p(99)<3000'],
    'errors': ['rate<0.01'],
    'cart_fetch_time': ['p(95)<1500'],
    'cart_mutation_time': ['p(95)<2000'],
    'checkout_time': ['p(95)<2500'],
  },
};

// Test products for cart operations
const TEST_PRODUCTS = [
  { url: 'https://www.amazon.com/dp/B0TEST001', store: 'AMAZON' },
  { url: 'https://www.amazon.com/dp/B0TEST002', store: 'AMAZON' },
  { url: 'https://www.ebay.com/itm/123456789', store: 'EBAY' },
];

function getHeaders(token) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': ANON_KEY,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function getRandomProduct() {
  return TEST_PRODUCTS[Math.floor(Math.random() * TEST_PRODUCTS.length)];
}

function recordSuccess(metric) {
  metric.add(1);
  successfulOps.add(1);
  errorRate.add(0);
}

function recordFailure(response, operation) {
  failedOps.add(1);
  errorRate.add(1);
  
  if (response.status !== 401) {
    console.log(`${operation} failed: ${response.status}`);
  }
}

export default function() {
  activeUsers.add(1);
  
  // Weighted operation selection based on realistic traffic mix
  const op = Math.random();
  
  if (op < 0.60) {
    // 60% - Browse/Read operations
    group('Browse Operations', function() {
      // Cart fetch
      const cartResponse = http.get(`${BASE_URL}/mobile-get-cart`, {
        headers: getHeaders(TEST_TOKEN),
        tags: { name: 'cart_fetch', operation: 'browse' },
      });
      
      cartFetchTime.add(cartResponse.timings.duration);
      
      if (check(cartResponse, {
        'cart status 200': (r) => r.status === 200,
        'cart < 2s': (r) => r.timings.duration < 2000,
      })) {
        recordSuccess(successfulOps);
      } else {
        recordFailure(cartResponse, 'cart_fetch');
      }
      
      sleep(Math.random() * 2 + 1);
      
      // Occasionally check auth
      if (Math.random() < 0.3) {
        const authResponse = http.get(`${BASE_URL}/auth-me`, {
          headers: getHeaders(TEST_TOKEN),
          tags: { name: 'auth_check', operation: 'browse' },
        });
        
        authCheckTime.add(authResponse.timings.duration);
        
        check(authResponse, {
          'auth responds': (r) => r.status === 200 || r.status === 401,
        });
        
        sleep(0.5);
      }
    });
    
  } else if (op < 0.85) {
    // 25% - Cart mutations
    group('Cart Mutations', function() {
      const mutation = Math.random();
      
      if (mutation < 0.5) {
        // Add item
        const product = getRandomProduct();
        const payload = JSON.stringify({
          product_url: product.url,
          store: product.store,
          quantity: Math.ceil(Math.random() * 2),
        });
        
        const response = http.post(`${BASE_URL}/mobile-add-cart-item`, payload, {
          headers: getHeaders(TEST_TOKEN),
          tags: { name: 'add_item', operation: 'mutation' },
        });
        
        cartMutationTime.add(response.timings.duration);
        
        if (check(response, {
          'add returns 200/201': (r) => r.status === 200 || r.status === 201,
        })) {
          recordSuccess(successfulOps);
        } else {
          recordFailure(response, 'add_item');
        }
        
      } else {
        // Update or delete (need cart first)
        const cartResponse = http.get(`${BASE_URL}/mobile-get-cart`, {
          headers: getHeaders(TEST_TOKEN),
        });
        
        if (cartResponse.status === 200) {
          try {
            const cart = JSON.parse(cartResponse.body);
            const items = cart.activeItems || cart.items || [];
            
            if (items.length > 0) {
              const item = items[Math.floor(Math.random() * items.length)];
              
              if (mutation < 0.75) {
                // Update quantity
                const payload = JSON.stringify({
                  item_id: item.id,
                  quantity: Math.ceil(Math.random() * 5),
                });
                
                const response = http.post(`${BASE_URL}/mobile-update-cart-item`, payload, {
                  headers: getHeaders(TEST_TOKEN),
                  tags: { name: 'update_item', operation: 'mutation' },
                });
                
                cartMutationTime.add(response.timings.duration);
                
                if (response.status === 200) {
                  recordSuccess(successfulOps);
                } else {
                  recordFailure(response, 'update_item');
                }
                
              } else {
                // Delete item
                const payload = JSON.stringify({ item_id: item.id });
                
                const response = http.post(`${BASE_URL}/mobile-delete-cart-item`, payload, {
                  headers: getHeaders(TEST_TOKEN),
                  tags: { name: 'delete_item', operation: 'mutation' },
                });
                
                cartMutationTime.add(response.timings.duration);
                
                if (response.status === 200) {
                  recordSuccess(successfulOps);
                } else {
                  recordFailure(response, 'delete_item');
                }
              }
            }
          } catch (e) {
            // Parse error, skip
          }
        }
      }
      
      sleep(Math.random() * 2 + 0.5);
    });
    
  } else if (op < 0.95) {
    // 10% - Checkout initialization
    group('Checkout Flow', function() {
      // Get cart first
      const cartResponse = http.get(`${BASE_URL}/mobile-get-cart`, {
        headers: getHeaders(TEST_TOKEN),
      });
      
      if (cartResponse.status === 200) {
        try {
          const cart = JSON.parse(cartResponse.body);
          const items = (cart.activeItems || cart.items || []).map(i => i.id);
          
          if (items.length > 0) {
            const payload = JSON.stringify({
              cart_item_ids: items,
              payment_method: 'MOBILE_MONEY',
              currency: 'USD',
            });
            
            const response = http.post(`${BASE_URL}/mobile-checkout`, payload, {
              headers: getHeaders(TEST_TOKEN),
              tags: { name: 'checkout_init', operation: 'checkout' },
            });
            
            checkoutTime.add(response.timings.duration);
            
            if (check(response, {
              'checkout valid status': (r) => [200, 201, 400, 401].includes(r.status),
              'checkout < 3s': (r) => r.timings.duration < 3000,
            })) {
              if (response.status === 200 || response.status === 201) {
                recordSuccess(successfulOps);
              }
            } else {
              recordFailure(response, 'checkout');
            }
          }
        } catch (e) {
          // Parse error
        }
      }
      
      sleep(Math.random() * 3 + 2);
    });
    
  } else {
    // 5% - Order status check
    group('Order Status', function() {
      const response = http.get(`${BASE_URL}/mobile-get-orders`, {
        headers: getHeaders(TEST_TOKEN),
        tags: { name: 'order_status', operation: 'status' },
      });
      
      orderStatusTime.add(response.timings.duration);
      
      if (check(response, {
        'orders responds': (r) => r.status === 200 || r.status === 401,
      })) {
        recordSuccess(successfulOps);
      } else {
        recordFailure(response, 'order_status');
      }
      
      sleep(Math.random() * 2 + 1);
    });
  }
  
  activeUsers.add(-1);
}

export function setup() {
  console.log('='.repeat(60));
  console.log('FULL USER JOURNEY LOAD TEST');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Token provided: ${!!TEST_TOKEN}`);
  console.log(`VUs: ${__ENV.VUS || 100}`);
  console.log(`Duration: ${__ENV.DURATION || '10m'}`);
  console.log('');
  console.log('Traffic Mix:');
  console.log('  - 60% Browse (cart fetch, auth check)');
  console.log('  - 25% Cart mutations (add, update, delete)');
  console.log('  - 10% Checkout initialization');
  console.log('  - 5% Order status checks');
  console.log('');
  console.log('Scenarios:');
  console.log('  - steady_load: Ramp to VUs and hold');
  console.log('  - spike_test: Sudden 2x traffic spike at 5 min');
  console.log('');
  
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log('');
  console.log('='.repeat(60));
  console.log('FULL USER JOURNEY TEST COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total duration: ${duration.toFixed(2)}s`);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    test: 'full_user_journey',
    scenarios: ['steady_load', 'spike_test'],
    metrics: {
      http_reqs: data.metrics.http_reqs?.values?.count || 0,
      http_req_duration_p50: data.metrics.http_req_duration?.values?.['p(50)'] || 0,
      http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
      http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
      error_rate: data.metrics.errors?.values?.rate || 0,
      cart_fetch_p95: data.metrics.cart_fetch_time?.values?.['p(95)'] || 0,
      cart_mutation_p95: data.metrics.cart_mutation_time?.values?.['p(95)'] || 0,
      checkout_p95: data.metrics.checkout_time?.values?.['p(95)'] || 0,
      order_status_p95: data.metrics.order_status_time?.values?.['p(95)'] || 0,
      successful_operations: data.metrics.successful_operations?.values?.count || 0,
      failed_operations: data.metrics.failed_operations?.values?.count || 0,
    },
    thresholds: {
      passed: Object.values(data.thresholds || {}).every(t => t.ok),
      details: Object.entries(data.thresholds || {}).map(([k, v]) => ({
        name: k,
        passed: v.ok,
      })),
    },
  };
  
  return {
    'tests/load/results/full_user_journey.json': JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
