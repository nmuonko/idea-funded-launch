/**
 * Strip unwanted marketplace condition / warranty noise from product titles
 * and descriptions so customers never see words like "reconditionné",
 * "refurbished", "renewed", or "garantie".
 */
export function cleanProductText(text: string): string {
  if (!text) return "";
  let t = text;

  // Remove whole parenthetical fragments if they contain unwanted condition noise.
  t = t.replace(/\([^)]*(?:refurbished|renewed|reconditionn[ée]|seller[-\s]?refurbished|garantie)[^)]*\)/gi, "");

  // Whole-word removals (case-insensitive)
  const unwanted = [
    /\brefurbished\b/gi,
    /\brenewed\b/gi,
    /\breconditionn[ée]\s*(?:par\s*le\s*vendeur)?\b/gi,
    /\bgarantie\b/gi,
    /\bpre[-\s]?owned\b/gi,
    /\bseller[-\s]?refurbished\b/gi,
  ];
  for (const re of unwanted) {
    t = t.replace(re, "");
  }

  // Collapse leftover double spaces, stray punctuation clusters
  t = t.replace(/\s{2,}/g, " ");
  t = t.replace(/\s*[,;:\-–—·]+\s*/g, " ");
  t = t.replace(/\(\s*\)|\[\s*\]/g, "");
  t = t.replace(/\s{2,}/g, " ");
  return t.trim();
}
