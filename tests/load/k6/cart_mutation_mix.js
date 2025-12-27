/**
 * k6 Load Test: Cart Mutation Mix
 * 
 * Simulates cart mutation operations (25% of typical traffic)
 * Tests add/update/delete cart item operations
 * 
 * USAGE: k6 run --env BASE_URL=https://... --env TEST_TOKEN=... tests/load/k6/cart_mutation_mix.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const addItemTime = new Trend('add_item_time', true);
const updateItemTime = new Trend('update_item_time', true);
const deleteItemTime = new Trend('delete_item_time', true);
const successfulMutations = new Counter('successful_mutations');
const failedMutations = new Counter('failed_mutations');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1';
const TEST_TOKEN = __ENV.TEST_TOKEN || '';
const ANON_KEY = __ENV.ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbWtoeGZmbnl6b29nY3F2ZGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMzM2NjYsImV4cCI6MjA3OTcwOTY2Nn0.xMa-K25tL63StMYRZDq7xovDPyrWlB_LA-KkGciqZaA';

// Test options
export const options = {
  scenarios: {
    cart_mutations: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: parseInt(__ENV.VUS) || 50 },
        { duration: __ENV.DURATION || '8m', target: parseInt(__ENV.VUS) || 50 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<2000', 'p(99)<4000'],
    'errors': ['rate<0.02'],
    'add_item_time': ['p(95)<2500'],
    'update_item_time': ['p(95)<2000'],
  },
};

// Test product URLs for cart operations
const TEST_PRODUCTS = [
  { url: 'https://www.amazon.com/dp/B0TEST001', store: 'AMAZON', title: 'Test Product 1' },
  { url: 'https://www.amazon.com/dp/B0TEST002', store: 'AMAZON', title: 'Test Product 2' },
  { url: 'https://www.ebay.com/itm/123456789', store: 'EBAY', title: 'Test eBay Item' },
  { url: 'https://www.walmart.com/ip/123456', store: 'WALMART', title: 'Test Walmart Item' },
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

export default function() {
  // Random operation distribution: 50% add, 30% update, 20% delete
  const operation = Math.random();
  
  if (operation < 0.5) {
    // Add item to cart
    group('Add Cart Item', function() {
      const product = getRandomProduct();
      
      const payload = JSON.stringify({
        product_url: product.url,
        store: product.store,
        quantity: Math.ceil(Math.random() * 3),
      });
      
      const response = http.post(`${BASE_URL}/mobile-add-cart-item`, payload, {
        headers: getHeaders(TEST_TOKEN),
        tags: { name: 'add_item' },
      });
      
      addItemTime.add(response.timings.duration);
      
      const success = check(response, {
        'add item returns 200 or 201': (r) => r.status === 200 || r.status === 201,
        'add item response time < 3s': (r) => r.timings.duration < 3000,
      });
      
      if (success) {
        successfulMutations.add(1);
        errorRate.add(0);
      } else {
        failedMutations.add(1);
        errorRate.add(1);
        
        if (response.status >= 400 && response.status !== 401) {
          console.log(`Add item failed: ${response.status} - ${response.body.substring(0, 200)}`);
        }
      }
      
      sleep(Math.random() * 2 + 0.5);
    });
    
  } else if (operation < 0.8) {
    // Update cart item quantity
    group('Update Cart Item', function() {
      // First get cart to find an item ID
      const cartResponse = http.get(`${BASE_URL}/mobile-get-cart`, {
        headers: getHeaders(TEST_TOKEN),
      });
      
      if (cartResponse.status === 200) {
        try {
          const cart = JSON.parse(cartResponse.body);
          const items = cart.activeItems || cart.items || [];
          
          if (items.length > 0) {
            const item = items[Math.floor(Math.random() * items.length)];
            
            const payload = JSON.stringify({
              item_id: item.id,
              quantity: Math.ceil(Math.random() * 5),
            });
            
            const updateResponse = http.post(`${BASE_URL}/mobile-update-cart-item`, payload, {
              headers: getHeaders(TEST_TOKEN),
              tags: { name: 'update_item' },
            });
            
            updateItemTime.add(updateResponse.timings.duration);
            
            const success = check(updateResponse, {
              'update item returns 200': (r) => r.status === 200,
              'update response time < 2s': (r) => r.timings.duration < 2000,
            });
            
            if (success) {
              successfulMutations.add(1);
              errorRate.add(0);
            } else {
              failedMutations.add(1);
              errorRate.add(1);
            }
          }
        } catch (e) {
          // Parse error, skip this iteration
        }
      }
      
      sleep(Math.random() * 2 + 0.5);
    });
    
  } else {
    // Delete cart item
    group('Delete Cart Item', function() {
      // First get cart to find an item ID
      const cartResponse = http.get(`${BASE_URL}/mobile-get-cart`, {
        headers: getHeaders(TEST_TOKEN),
      });
      
      if (cartResponse.status === 200) {
        try {
          const cart = JSON.parse(cartResponse.body);
          const items = cart.activeItems || cart.items || [];
          
          if (items.length > 0) {
            const item = items[Math.floor(Math.random() * items.length)];
            
            const payload = JSON.stringify({
              item_id: item.id,
            });
            
            const deleteResponse = http.post(`${BASE_URL}/mobile-delete-cart-item`, payload, {
              headers: getHeaders(TEST_TOKEN),
              tags: { name: 'delete_item' },
            });
            
            deleteItemTime.add(deleteResponse.timings.duration);
            
            const success = check(deleteResponse, {
              'delete item returns 200': (r) => r.status === 200,
              'delete response time < 2s': (r) => r.timings.duration < 2000,
            });
            
            if (success) {
              successfulMutations.add(1);
              errorRate.add(0);
            } else {
              failedMutations.add(1);
              errorRate.add(1);
            }
          }
        } catch (e) {
          // Parse error, skip
        }
      }
      
      sleep(Math.random() * 2 + 0.5);
    });
  }
}

export function setup() {
  console.log('='.repeat(50));
  console.log('CART MUTATION MIX LOAD TEST');
  console.log('='.repeat(50));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Token provided: ${!!TEST_TOKEN}`);
  console.log(`VUs: ${__ENV.VUS || 50}`);
  console.log(`Duration: ${__ENV.DURATION || '10m'}`);
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
    test: 'cart_mutation_mix',
    metrics: {
      http_reqs: data.metrics.http_reqs?.values?.count || 0,
      http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
      http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
      error_rate: data.metrics.errors?.values?.rate || 0,
      add_item_p95: data.metrics.add_item_time?.values?.['p(95)'] || 0,
      update_item_p95: data.metrics.update_item_time?.values?.['p(95)'] || 0,
      delete_item_p95: data.metrics.delete_item_time?.values?.['p(95)'] || 0,
      successful_mutations: data.metrics.successful_mutations?.values?.count || 0,
      failed_mutations: data.metrics.failed_mutations?.values?.count || 0,
    },
    thresholds: {
      passed: Object.values(data.thresholds || {}).every(t => t.ok),
    },
  };
  
  return {
    'tests/load/results/cart_mutation_mix.json': JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
