/**
 * Strict category relevance filtering with include + exclude keyword rules.
 * Prevents cross-category contamination (e.g., sofas in "Electronics").
 */

import { Product } from '@/components/shop/ProductCard';

interface CategoryRule {
  include: string[];
  exclude: string[];
}

const CATEGORY_RULES: Record<string, CategoryRule> = {
  phones: {
    include: ['iphone', 'samsung', 'galaxy', 'pixel', 'phone', 'smartphone', 'android', 'ios', 'mobile', 'cellphone', 'téléphone', 'oneplus', 'xiaomi', 'motorola', 'nokia', 'huawei', 'oppo', 'vivo', 'realme', 'unlocked'],
    exclude: ['sofa', 'couch', 'recliner', 'table', 'mattress', 'chair', 'bed', 'furniture', 'lamp', 'curtain', 'rug'],
  },
  electronics: {
    include: ['laptop', 'macbook', 'tv', 'oled', 'monitor', 'camera', 'tablet', 'headphones', 'earbuds', 'charger', 'usb', 'ssd', 'gpu', 'cpu', 'computer', 'printer', 'router', 'keyboard', 'mouse', 'speaker', 'drone', 'ipad', 'dell', 'hp', 'lenovo', 'asus', 'acer', 'bluetooth', 'wireless', 'electronic', 'smart', 'hard drive', 'ram', 'television'],
    exclude: ['sofa', 'couch', 'recliner', 'dining', 'bed', 'mattress', 'chair', 'furniture', 'lamp', 'curtain', 'rug', 'pillow', 'shirt', 'dress', 'pants', 'shoes'],
  },
  gaming: {
    include: ['playstation', 'ps5', 'ps4', 'xbox', 'nintendo', 'switch', 'controller', 'console', 'gaming', 'pc gamer', 'game', 'jeu', 'gamer', 'steam', 'rtx', 'geforce', 'razer', 'corsair', 'logitech g'],
    exclude: ['sofa', 'couch', 'recliner', 'mattress', 'bed', 'chair', 'table', 'furniture', 'shirt', 'dress', 'shoes'],
  },
  vehicles: {
    include: ['car', 'suv', 'truck', 'vehicle', 'toyota', 'honda', 'ford', 'bmw', 'mercedes', 'chevrolet', 'land cruiser', 'mustang', 'cr-v', 'rav4', 'tires', 'wheels', 'voiture', 'pickup', 'engine', 'motorcycle', 'moto', 'jeep', 'nissan', 'audi', 'hyundai', 'kia'],
    exclude: ['laptop', 'macbook', 'iphone', 'ps5', 'xbox', 'sofa', 'shirt', 'dress', 'headphones'],
  },
  clothing: {
    include: ['shirt', 't-shirt', 'hoodie', 'dress', 'pants', 'jeans', 'shoes', 'sneakers', 'jacket', 'fashion', 'mode', 'coat', 'skirt', 'bag', 'handbag', 'hat', 'cap', 'nike', 'adidas', 'puma', 'zara', 'levi', 'boot', 'vêtement'],
    exclude: ['iphone', 'ps5', 'macbook', 'laptop', 'sofa', 'tv', 'monitor', 'console'],
  },
  home_garden: {
    include: ['sofa', 'couch', 'recliner', 'dining', 'table', 'chair', 'bed', 'mattress', 'fridge', 'freezer', 'washer', 'microwave', 'blender', 'air conditioner', 'kitchen', 'oven', 'lamp', 'furniture', 'décor', 'decor', 'garden', 'jardin', 'maison', 'salon', 'curtain', 'rug', 'pillow', 'shelf', 'cabinet', 'desk'],
    exclude: ['iphone', 'ps5', 'xbox', 'macbook', 'laptop', 'smartphone'],
  },
  toys: {
    include: ['lego', 'toy', 'puzzle', 'doll', 'kids', 'set', 'jouet', 'action figure', 'barbie', 'nerf', 'playset', 'rc car', 'plush', 'stuffed', 'board game', 'enfant', 'children'],
    exclude: ['iphone', 'macbook', 'laptop', 'sofa', 'ps5', 'car'],
  },
  sporting_goods: {
    include: ['sport', 'gym', 'yoga', 'fitness', 'dumbbell', 'treadmill', 'ball', 'running', 'bicycle', 'bike', 'soccer', 'football', 'basketball', 'tennis', 'golf', 'camping', 'hiking', 'outdoor', 'exercise', 'weight'],
    exclude: ['iphone', 'macbook', 'laptop', 'sofa', 'ps5', 'couch'],
  },
  jewelry_watches: {
    include: ['watch', 'jewelry', 'necklace', 'ring', 'bracelet', 'diamond', 'gold', 'silver', 'montre', 'bijou', 'earring', 'rolex', 'casio', 'seiko', 'fossil', 'pendant'],
    exclude: ['iphone', 'ps5', 'macbook', 'laptop', 'sofa', 'tv', 'console'],
  },
  parts_accessories: {
    include: ['carplay', 'gps', 'dash cam', 'head unit', 'auto part', 'car part', 'brake', 'filter', 'alternator', 'battery', 'headlight', 'bumper', 'mirror', 'wiper', 'spark plug', 'oil', 'transmission', 'radiator', 'pièce', 'accessoire auto'],
    exclude: ['sofa', 'mattress', 'shirt', 'dress', 'iphone', 'ps5'],
  },
  refurbished: {
    include: ['refurbished', 'renewed', 'reconditionné', 'open box', 'used - very good', 'used - good', 'certified', 'pre-owned', 'occasion'],
    exclude: [],
  },
};

/**
 * Check if a product is relevant to a category using strict include/exclude rules.
 * Returns true if the product title matches at least one include keyword
 * AND does not match any exclude keyword.
 * For 'all' category, always returns true.
 */
export function isRelevantToCategory(product: { title?: string }, categoryKey: string): boolean {
  if (categoryKey === 'all') return true;

  const rule = CATEGORY_RULES[categoryKey];
  if (!rule) return true; // Unknown category — allow

  const titleLower = (product.title || '').toLowerCase();

  // Check exclude first — if any exclude keyword matches, reject
  if (rule.exclude.length > 0) {
    for (const kw of rule.exclude) {
      if (titleLower.includes(kw)) return false;
    }
  }

  // Check include — at least one keyword must match
  if (rule.include.length > 0) {
    return rule.include.some(kw => titleLower.includes(kw));
  }

  return true;
}
