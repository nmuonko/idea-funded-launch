/** Approximate EU/Turkey clothing equivalents; supplier values remain order identifiers. */
const WOMEN = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const MEN = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
export function vipSizeLabel(size: string, category: string): string {
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
    return Number.isInteger(index) && letters[index] ? `${letters[index]} · EU ${number}` : size;
  }
  const normalized = size.trim().toUpperCase().replace(/^2XL$/, 'XXL').replace(/^XXXL$/, '3XL');
  const index = letters.indexOf(normalized);
  return index >= 0 ? `${normalized} · EU ${base + index * 2}` : size;
}