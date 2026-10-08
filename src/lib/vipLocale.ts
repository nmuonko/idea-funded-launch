// VIP storefront language: English primary, French when the browser prefers French.
export const vipPrefersFrench = () =>
  typeof navigator !== 'undefined' && /^fr\b/i.test(navigator.language || '');

export function localizeVip<T extends { name_fr: string | null; description_fr: string | null; name_en?: string | null; description_en?: string | null }>(p: T): T {
  if (vipPrefersFrench()) return p;
  return { ...p, name_fr: p.name_en || p.name_fr, description_fr: p.description_en || p.description_fr };
}
