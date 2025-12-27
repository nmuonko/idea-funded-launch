/**
 * k6 Load Test: Cart Read Heavy
 * 
 * Simulates heavy cart read operations (60% of typical traffic)
 * Tests mobile-get-cart endpoint under load
 * 
 * USAGE: k6 run --env BASE_URL=https://... --env TEST_TOKEN=... tests/load/k6/cart_read_heavy.js
 * 
 * ENV VARS:
 *   BASE_URL - Supabase functions URL
 *   TEST_TOKEN - Valid user JWT token
 *   DURATION - Test duration (default: 10m)
 *   VUS - Virtual users (default: 100)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const cartFetchTime = new Trend('cart_fetch_time', true);
const successfulRequests = new Counter('successful_requests');
const failedRequests = new Counter('failed_requests');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1';
const TEST_TOKEN = __ENV.TEST_TOKEN || '';
const ANON_KEY = __ENV.ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbWtoeGZmbnl6b29nY3F2ZGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMzM2NjYsImV4cCI6MjA3OTcwOTY2Nn0.xMa-K25tL63StMYRZDq7xovDPyrWlB_LA-KkGciqZaA';

// Test options
export const options = {
  scenarios: {
    cart_reads: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: parseInt(__ENV.VUS) || 100 },   // Ramp up to VUS
        { duration: __ENV.DURATION || '8m', target: parseInt(__ENV.VUS) || 100 }, // Stay at VUS
        { duration: '1m', target: 0 },                            // Ramp down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<1500', 'p(99)<3000'],  // p95 < 1.5s, p99 < 3s
    'errors': ['rate<0.01'],                            // Error rate < 1%
    'cart_fetch_time': ['p(95)<1500'],                  // Cart fetch p95 < 1.5s
  },
};

// Request headers
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

// Main test function
export default function() {
  group('Cart Read Operations', function() {
    // Simulate cart fetch (primary operation)
    const cartResponse = http.get(`${BASE_URL}/mobile-get-cart`, {
      headers: getHeaders(TEST_TOKEN),
      tags: { name: 'cart_fetch' },
    });
    
    cartFetchTime.add(cartResponse.timings.duration);
    
    const cartSuccess = check(cartResponse, {
      'cart fetch status is 200': (r) => r.status === 200,
      'cart has ok field': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.ok === true || body.ok === false;
        } catch {
          return false;
        }
      },
      'cart response time < 2s': (r) => r.timings.duration < 2000,
    });
    
    if (cartSuccess) {
      successfulRequests.add(1);
      errorRate.add(0);
    } else {
      failedRequests.add(1);
      errorRate.add(1);
      
      // Log failures for debugging
      if (cartResponse.status !== 200) {
        console.log(`Cart fetch failed: status=${cartResponse.status}, body=${cartResponse.body.substring(0, 200)}`);
      }
    }
    
    // Simulate think time (user browsing)
    sleep(Math.random() * 2 + 1); // 1-3 seconds
  });
  
  // Occasionally check auth (10% of requests)
  if (Math.random() < 0.1) {
    group('Auth Check', function() {
      const authResponse = http.get(`${BASE_URL}/auth-me`, {
        headers: getHeaders(TEST_TOKEN),
        tags: { name: 'auth_check' },
      });
      
      check(authResponse, {
        'auth check status is 200 or 401': (r) => r.status === 200 || r.status === 401,
      });
      
      sleep(0.5);
    });
  }
}

// Setup function - runs once before test
export function setup() {
  console.log('='.repeat(50));
  console.log('CART READ HEAVY LOAD TEST');
  console.log('='.repeat(50));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Token provided: ${!!TEST_TOKEN}`);
  console.log(`VUs: ${__ENV.VUS || 100}`);
  console.log(`Duration: ${__ENV.DURATION || '10m'}`);
  console.log('');
  
  // Warm-up request
  const warmup = http.get(`${BASE_URL}/mobile-get-cart`, {
    headers: getHeaders(TEST_TOKEN),
  });
  
  console.log(`Warmup response: ${warmup.status}`);
  
  return { startTime: Date.now() };
}

// Teardown function - runs once after test
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log('');
  console.log('='.repeat(50));
  console.log('TEST COMPLETE');
  console.log('='.repeat(50));
  console.log(`Total duration: ${duration.toFixed(2)}s`);
}

// Handle summary
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    test: 'cart_read_heavy',
    metrics: {
      http_reqs: data.metrics.http_reqs?.values?.count || 0,
      http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
      http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
      error_rate: data.metrics.errors?.values?.rate || 0,
      cart_fetch_p95: data.metrics.cart_fetch_time?.values?.['p(95)'] || 0,
      successful_requests: data.metrics.successful_requests?.values?.count || 0,
      failed_requests: data.metrics.failed_requests?.values?.count || 0,
    },
    thresholds: {
      passed: Object.values(data.thresholds || {}).every(t => t.ok),
    },
  };
  
  return {
    'tests/load/results/cart_read_heavy.json': JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

// Import text summary helper
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
