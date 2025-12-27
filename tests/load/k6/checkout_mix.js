/**
 * k6 Load Test: Checkout Mix
 * 
 * Simulates checkout initialization and order creation (10% of traffic)
 * Critical path testing for payment flows
 * 
 * USAGE: k6 run --env BASE_URL=https://... --env TEST_TOKEN=... tests/load/k6/checkout_mix.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const checkoutInitTime = new Trend('checkout_init_time', true);
const paymentDecisionTime = new Trend('payment_decision_time', true);
const profileFetchTime = new Trend('profile_fetch_time', true);
const successfulCheckouts = new Counter('successful_checkouts');
const failedCheckouts = new Counter('failed_checkouts');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1';
const TEST_TOKEN = __ENV.TEST_TOKEN || '';
const ANON_KEY = __ENV.ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbWtoeGZmbnl6b29nY3F2ZGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMzM2NjYsImV4cCI6MjA3OTcwOTY2Nn0.xMa-K25tL63StMYRZDq7xovDPyrWlB_LA-KkGciqZaA';

// Checkout is critical - use fewer VUs but stricter thresholds
export const options = {
  scenarios: {
    checkout_flow: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: parseInt(__ENV.VUS) || 25 },
        { duration: __ENV.DURATION || '9m', target: parseInt(__ENV.VUS) || 25 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<2500', 'p(99)<5000'],
    'errors': ['rate<0.02'],
    'checkout_init_time': ['p(95)<2500'],
    'payment_decision_time': ['p(95)<1000'],
  },
};

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

export default function() {
  // Simulate checkout flow
  group('Checkout Flow', function() {
    
    // Step 1: Get user profile
    group('Profile Fetch', function() {
      const profileResponse = http.get(`${BASE_URL}/mobile-profile`, {
        headers: getHeaders(TEST_TOKEN),
        tags: { name: 'profile_fetch' },
      });
      
      profileFetchTime.add(profileResponse.timings.duration);
      
      check(profileResponse, {
        'profile returns 200 or 401': (r) => r.status === 200 || r.status === 401,
      });
      
      sleep(0.5);
    });
    
    // Step 2: Get cart with items
    let cartItems = [];
    group('Cart Fetch', function() {
      const cartResponse = http.get(`${BASE_URL}/mobile-get-cart`, {
        headers: getHeaders(TEST_TOKEN),
        tags: { name: 'cart_fetch' },
      });
      
      if (cartResponse.status === 200) {
        try {
          const cart = JSON.parse(cartResponse.body);
          cartItems = (cart.activeItems || cart.items || []).map(i => i.id);
        } catch (e) {
          // Parse error
        }
      }
      
      sleep(0.5);
    });
    
    // Step 3: Payment decision
    group('Payment Decision', function() {
      const decisionPayload = JSON.stringify({
        total_usd: 50 + Math.random() * 200, // Random amount $50-$250
        currency: 'USD',
      });
      
      const decisionResponse = http.post(`${BASE_URL}/payment-decision`, decisionPayload, {
        headers: getHeaders(TEST_TOKEN),
        tags: { name: 'payment_decision' },
      });
      
      paymentDecisionTime.add(decisionResponse.timings.duration);
      
      check(decisionResponse, {
        'payment decision returns 200 or 400': (r) => r.status === 200 || r.status === 400 || r.status === 401,
        'payment decision time < 1.5s': (r) => r.timings.duration < 1500,
      });
      
      sleep(0.5);
    });
    
    // Step 4: Initialize checkout (only if we have cart items)
    if (cartItems.length > 0) {
      group('Checkout Init', function() {
        const checkoutPayload = JSON.stringify({
          cart_item_ids: cartItems,
          payment_method: Math.random() > 0.5 ? 'MOBILE_MONEY' : 'CARD',
          currency: 'USD',
        });
        
        const checkoutResponse = http.post(`${BASE_URL}/mobile-checkout`, checkoutPayload, {
          headers: getHeaders(TEST_TOKEN),
          tags: { name: 'checkout_init' },
        });
        
        checkoutInitTime.add(checkoutResponse.timings.duration);
        
        const success = check(checkoutResponse, {
          'checkout returns valid status': (r) => [200, 201, 400, 401, 402].includes(r.status),
          'checkout time < 3s': (r) => r.timings.duration < 3000,
        });
        
        if (checkoutResponse.status === 200 || checkoutResponse.status === 201) {
          successfulCheckouts.add(1);
          errorRate.add(0);
        } else {
          failedCheckouts.add(1);
          errorRate.add(1);
          
          // Log checkout errors (excluding auth errors)
          if (checkoutResponse.status >= 400 && checkoutResponse.status !== 401) {
            console.log(`Checkout failed: ${checkoutResponse.status} - ${checkoutResponse.body.substring(0, 300)}`);
          }
        }
        
        sleep(1);
      });
    } else {
      // No items in cart - simulate empty cart checkout
      group('Empty Cart Checkout', function() {
        const emptyCheckoutPayload = JSON.stringify({
          cart_item_ids: [],
          payment_method: 'MOBILE_MONEY',
        });
        
        const response = http.post(`${BASE_URL}/mobile-checkout`, emptyCheckoutPayload, {
          headers: getHeaders(TEST_TOKEN),
          tags: { name: 'checkout_empty' },
        });
        
        // Empty cart should return 400 EMPTY_CART
        check(response, {
          'empty cart returns 400': (r) => r.status === 400,
        });
        
        sleep(0.5);
      });
    }
    
    // Think time between checkout attempts
    sleep(Math.random() * 3 + 2);
  });
}

export function setup() {
  console.log('='.repeat(50));
  console.log('CHECKOUT MIX LOAD TEST');
  console.log('='.repeat(50));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Token provided: ${!!TEST_TOKEN}`);
  console.log(`VUs: ${__ENV.VUS || 25}`);
  console.log(`Duration: ${__ENV.DURATION || '10m'}`);
  console.log('');
  console.log('NOTE: This test simulates checkout but does NOT complete payments');
  console.log('');
  
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log('');
  console.log('='.repeat(50));
  console.log('TEST COMPLETE');
  console.log('='.repeat(50));
  console.log(`Total duration: ${duration.toFixed(2)}s`);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    test: 'checkout_mix',
    metrics: {
      http_reqs: data.metrics.http_reqs?.values?.count || 0,
      http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
      http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
      error_rate: data.metrics.errors?.values?.rate || 0,
      checkout_init_p95: data.metrics.checkout_init_time?.values?.['p(95)'] || 0,
      payment_decision_p95: data.metrics.payment_decision_time?.values?.['p(95)'] || 0,
      profile_fetch_p95: data.metrics.profile_fetch_time?.values?.['p(95)'] || 0,
      successful_checkouts: data.metrics.successful_checkouts?.values?.count || 0,
      failed_checkouts: data.metrics.failed_checkouts?.values?.count || 0,
    },
    thresholds: {
      passed: Object.values(data.thresholds || {}).every(t => t.ok),
    },
  };
  
  return {
    'tests/load/results/checkout_mix.json': JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
