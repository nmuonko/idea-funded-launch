import { describe, it, expect } from 'vitest';
import { computeVipPrice } from './vipPricing';

describe('computeVipPrice', () => {
  it('matches the spec example: Polo $12, 0.5kg, $30/kg, 10% buffer, 30% markup = $32.10', () => {
    const r = computeVipPrice(12, 0.5, 30, 10, 30);
    expect(r.shippingCost).toBe(15);
    expect(r.shippingBuffer).toBe(1.5);
    expect(r.profit).toBe(3.6);
    expect(r.finalPrice).toBe(32.1);
  });

  it('applies markup only to the purchase price, never to shipping', () => {
    const r = computeVipPrice(100, 1, 30, 10, 30);
    // profit must be 30 (30% of 100), not 30% of (100+30+3)
    expect(r.profit).toBe(30);
    expect(r.finalPrice).toBe(100 + 30 + 3 + 30);
  });

  it('uses updated percentages when settings change', () => {
    const r = computeVipPrice(12, 0.5, 30, 15, 40);
    expect(r.shippingBuffer).toBe(2.25);
    expect(r.profit).toBe(4.8);
    expect(r.finalPrice).toBe(34.05);
  });

  it('rounds the final price to two decimals', () => {
    const r = computeVipPrice(7.77, 0.3, 33, 10, 30);
    expect(r.finalPrice).toBe(Math.round(r.finalPrice * 100) / 100);
  });

  it('handles wedding dress tier: $200, 10kg, $105/kg', () => {
    const r = computeVipPrice(200, 10, 105, 10, 30);
    expect(r.shippingCost).toBe(1050);
    expect(r.shippingBuffer).toBe(105);
    expect(r.profit).toBe(60);
    expect(r.finalPrice).toBe(1415);
  });
});
