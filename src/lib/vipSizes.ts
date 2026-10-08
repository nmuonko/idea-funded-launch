/** Approximate EU/Turkey clothing equivalents; supplier values remain order identifiers. */
const WOMEN = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const MEN = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
export type VipSizeDisplay = 'combined' | 'letters' | 'numbers';
export function vipSizeLabel(size: string, category: string, display: VipSizeDisplay = 'combined'): string {
  if (/shoe|chaussure|baby|bébé|kid|child|enfant/i.test(category)) return size;
  const women = /women|dress|gown|robe|femme|bridal/i.test(category);
  const men = /men|shirt|polo|suit|pant|jean|homme/i.test(category);
  if (!women && !men) return size;
  const base = women ? 32 : 40;
  const letters = women ? WOMEN : MEN;
  const numeric = size.trim().match(/^(?:EU\s*|TR\s*)?(\d{2})$/i);
  if (numeric) {
    const number = Number(numeric[1]);
    const index = (number - base) / 2;
    if (!Number.isInteger(index) || !letters[index]) return size;
    return display === 'letters' ? letters[index] : display === 'numbers' ? String(number) : `${letters[index]} · EU ${number}`;
  }
  const normalized = size.trim().toUpperCase().replace(/^2XL$/, 'XXL').replace(/^XXXL$/, '3XL');
  const index = letters.indexOf(normalized);
  if (index < 0) return size;
  return display === 'letters' ? normalized : display === 'numbers' ? String(base + index * 2) : `${normalized} · EU ${base + index * 2}`;
}