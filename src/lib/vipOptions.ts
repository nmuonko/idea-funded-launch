/**
 * VIP store shared options: bilingual color presets and category-based size presets.
 */

export const VIP_COLOR_PRESETS: { en: string; fr: string }[] = [
  { en: 'Black', fr: 'Noir' },
  { en: 'White', fr: 'Blanc' },
  { en: 'Blue', fr: 'Bleu' },
  { en: 'Navy Blue', fr: 'Bleu marine' },
  { en: 'Red', fr: 'Rouge' },
  { en: 'Green', fr: 'Vert' },
  { en: 'Pink', fr: 'Rose' },
  { en: 'Yellow', fr: 'Jaune' },
  { en: 'Brown', fr: 'Marron' },
  { en: 'Beige', fr: 'Beige' },
  { en: 'Gray', fr: 'Gris' },
  { en: 'Purple', fr: 'Violet' },
  { en: 'Orange', fr: 'Orange' },
  { en: 'Burgundy', fr: 'Bordeaux' },
  { en: 'Multicolor', fr: 'Multicolore' },
];

export const VIP_SIZE_PRESETS: Record<string, string[]> = {
  adult: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'],
  baby: ['Newborn', '0-3 mois', '3-6 mois', '6-9 mois', '9-12 mois', '12-18 mois', '18-24 mois'],
  kids: ['2T', '3T', '4T', '5T', '6', '7', '8', '10', '12', '14', '16'],
  shoes_us: ['US 5', 'US 6', 'US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12', 'US 13'],
  shoes_uk: ['UK 4', 'UK 5', 'UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11', 'UK 12'],
  shoes_eu: ['EU 35', 'EU 36', 'EU 37', 'EU 38', 'EU 39', 'EU 40', 'EU 41', 'EU 42', 'EU 43', 'EU 44', 'EU 45', 'EU 46'],
};

/** Pick the most relevant size preset group for a category name. */
export function sizePresetForCategory(categoryName: string): string[] {
  const n = categoryName.toLowerCase();
  if (/baby|bébé|bebe/.test(n)) return VIP_SIZE_PRESETS.baby;
  if (/kid|child|enfant|garçon|fille/.test(n)) return VIP_SIZE_PRESETS.kids;
  if (/shoe|chaussure|sneaker|basket|sandale|boot/.test(n)) return VIP_SIZE_PRESETS.shoes_eu;
  return VIP_SIZE_PRESETS.adult;
}
