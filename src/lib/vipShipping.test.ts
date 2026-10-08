import { describe, it, expect } from 'vitest';
import {
  findBracket,
  bracketCostEur,
  allocateShipping,
  eurCentsToUsdCents,
  computeItalyPrice,
  type ShippingBracket,
} from './vipShipping';

const BRACKETS: ShippingBracket[] = [
  { min_kg: 0.5, max_kg: 1.5, express_eur: 40, standard_eur: null },
  { min_kg: 1.5, max_kg: 2.5, express_eur: 50, standard_eur: null },
  { min_kg: 2.5, max_kg: 3.5, express_eur: 65, standard_eur: 55 },
  { min_kg: 7.5, max_kg: 8.5, express_eur: 100, standard_eur: 90 },
  { min_kg: 24.5, max_kg: 29.5, express_eur: 280, standard_eur: 250 },
];

describe('findBracket', () => {
  it('finds the bracket containing the shipment weight', () => {
    expect(findBracket(BRACKETS, 8)?.express_eur).toBe(100);
    expect(findBracket(BRACKETS, 1)?.express_eur).toBe(40);
  });
  it('returns null below the first bracket and the top bracket above the last', () => {
    expect(findBracket(BRACKETS, 0.2)).toBeNull();
    expect(findBracket(BRACKETS, 40)?.express_eur).toBe(280);
  });
});

describe('bracketCostEur', () => {
  it('returns null when the service is unavailable for the bracket', () => {
    const b = findBracket(BRACKETS, 1)!;
    expect(bracketCostEur(b, 'standard')).toBeNull();
    expect(bracketCostEur(b, 'express')).toBe(40);
  });
});

describe('allocateShipping', () => {
  it('splits €90 across 8kg proportionally (0.5kg item gets €5.63)', () => {
    const weights = [0.5, 7.5];
    const out = allocateShipping(9000, weights);
    expect(out[0]).toBe(563); // €5.625 rounds to €5.63
    expect(out.reduce((s, c) => s + c, 0)).toBe(9000); // exact total
  });
  it('handles equal weights and empty input', () => {
    expect(allocateShipping(1000, [1, 1, 1]).reduce((s, c) => s + c, 0)).toBe(1000);
    expect(allocateShipping(1000, [])).toEqual([]);
  });
});

describe('eurCentsToUsdCents', () => {
  it('converts at the given rate (€90 at 1.08 → $97.20)', () => {
    expect(eurCentsToUsdCents(9000, 1.08)).toBe(9720);
  });
});

describe('computeItalyPrice', () => {
  it('matches the spec example: $20 + $7 shipping + 10% buffer + 30% profit = $33.70', () => {
    const r = computeItalyPrice({ purchasePriceUsd: 20, allocatedShippingUsd: 7, bufferPct: 10, markupPct: 30 });
    expect(r.shipping_buffer).toBe(0.7);
    expect(r.profit).toBe(6);
    expect(r.final_price).toBe(33.7);
  });
});
