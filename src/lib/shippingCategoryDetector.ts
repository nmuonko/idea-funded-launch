/**
 * Frontend shipping category detection — mirrors backend logic in
 * supabase/functions/_shared/allInclusivePricing.ts
 */

import type { ShippingCategoryInfo } from '@/lib/shippingCalculation';

export interface ShippingCategoryRow extends ShippingCategoryInfo {
  key: string;
}

const DEFAULT_CATEGORY: ShippingCategoryRow = {
  key: 'console_medium',
  est_weight_kg: 6,
  flat_shipping_usd: null,
  shipping_buffer_percent: 25,
  requires_manual_quote: false,
};

const CATEGORY_KEYWORDS: [string[], string[]][] = [
  [['phone_camera'], ['phone', 'iphone', 'samsung galaxy s', 'pixel', 'motorola', 'oneplus', 'camera', 'gopro', 'dslr', 'mirrorless']],
  [['small_accessories'], ['earbuds', 'airpods', 'earbud', 'smartwatch', 'apple watch', 'charger', 'cable', 'adapter', 'power bank', 'memory card', 'usb', 'dongle', 'stylus', 'airtag']],
  [['laptop'], ['laptop', 'macbook', 'chromebook', 'notebook', 'thinkpad', 'surface laptop', 'surface pro', 'surface book']],
  [['tablet'], ['ipad', 'tablet', 'galaxy tab', 'fire hd', 'kindle']],
  [['clothes_shoes'], ['shirt', 'dress', 'shoes', 'sneakers', 'jacket', 'pants', 'jeans', 'hoodie', 'sweater', 'clothing', 'apparel', 'boots', 'sandals', 'handbag', 'backpack']],
  [['console_medium'], ['playstation', 'xbox', 'nintendo', 'ps5', 'ps4', 'switch', 'printer', 'monitor', 'speaker', 'projector', 'router', 'steam deck']],
  [['tv_large_appliance'], ['tv', 'television', 'refrigerator', 'washer', 'dryer', 'furniture', 'sofa', 'couch', 'dishwasher', 'oven', 'microwave']],
];

export function detectShippingCategory(
  title: string,
  categoryKey: string | null | undefined,
  categories: ShippingCategoryRow[],
): ShippingCategoryRow {
  if (categories.length === 0) return DEFAULT_CATEGORY;

  const lowerCat = (categoryKey || '').toLowerCase();
  const directMatch = categories.find(c => c.key === lowerCat);
  if (directMatch) return directMatch;

  const lowerTitle = title.toLowerCase();

  for (const [catKeys, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some(kw => lowerTitle.includes(kw))) {
      for (const catKey of catKeys) {
        const match = categories.find(c => c.key === catKey);
        if (match) return match;
      }
    }
  }

  return categories.find(c => c.key === 'console_medium') || DEFAULT_CATEGORY;
}
