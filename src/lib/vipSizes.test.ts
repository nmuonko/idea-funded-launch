import { describe, it, expect } from 'vitest';
import { vipSizeLabel } from './vipSizes';
describe('VIP supplier size preservation and equivalents', () => {
  it('maps dress EU 40 to L and EU 50 to 5XL', () => {
    expect(vipSizeLabel('40', "Women's Formal Dress")).toBe('L · EU 40');
    expect(vipSizeLabel('50', "Women's Formal Dress")).toBe('5XL · EU 50');
  });
  it('maps letter clothing sizes back to numeric equivalents', () => {
    expect(vipSizeLabel('XL', "Women's Formal Dress")).toBe('XL · EU 42');
    expect(vipSizeLabel('M', 'Polo')).toBe('M · EU 46');
  });
  it('does not convert shoe, child or ambiguous sizes into adult letters', () => {
    expect(vipSizeLabel('40', "Italian Men's Shoes")).toBe('40');
    expect(vipSizeLabel('6', 'Kids Clothing')).toBe('6');
    expect(vipSizeLabel('US 10', "Women's Formal Dress")).toBe('US 10');
  });
});