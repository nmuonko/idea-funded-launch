/**
 * Cleans imported (Telegram/Turkey) product text for display:
 * - removes emojis (hearts, flags, etc.)
 * - removes any supplier price mentions (only our computed price is shown)
 * - lightly translates common Turkish product terms to English
 */

const EMOJI_RE =
  /[\u{1F1E6}-\u{1F1FF}]|[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{FE0F}\u{20E3}\u{2764}]|[\u{1F000}-\u{1F0FF}]/gu;

// Turkish / Arabic supplier price patterns: "25.$", "25 $", "$25", "250TL", "250 ₺", "Fiyat: 25"
const PRICE_RE =
  /(?:fiyat\s*[:=]?\s*)?(?:[$€₺]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:[$€₺]|tl|try|usd|dolar|lira))\.?/giu;

const TR_TERMS: Array<[RegExp, string]> = [
  [/\bkuma[sş]\b\s*:?/gi, 'Fabric:'],
  [/\bbeden(?:ler)?\b\s*:?/gi, 'Sizes:'],
  [/\brenk(?:ler)?\b\s*:?/gi, 'Colors:'],
  [/\bfiyat\b\s*:?/gi, 'Price:'],
  [/\bstok\b/gi, 'stock'],
  [/\byeni model\b/gi, 'New Model'],
  [/\byeni\b/gi, 'New'],
  [/\bmodel\b/gi, 'Model'],
  [/\belbise\b/gi, 'Dress'],
  [/\btak[iı]m\b/gi, 'Suit'],
  [/\bg[oö]mlek\b/gi, 'Shirt'],
  [/\bpantolon\b/gi, 'Trousers'],
  [/\bceket\b/gi, 'Jacket'],
  [/\bmont\b/gi, 'Coat'],
  [/\betek\b/gi, 'Skirt'],
  [/\bt[uü]nik\b/gi, 'Tunic'],
  [/\bbluz\b/gi, 'Blouse'],
  [/\bayakkab[iı]\b/gi, 'Shoes'],
  [/\bçanta\b/gi, 'Bag'],
  [/\bkad[iı]n\b/gi, "Women's"],
  [/\berkek\b/gi, "Men's"],
  [/\bçocuk\b/gi, "Kids'"],
  [/\bpamuk\b/gi, 'Cotton'],
  [/\bkot\b/gi, 'Denim'],
  [/\bketen\b/gi, 'Linen'],
  [/\bderi\b/gi, 'Leather'],
  [/\btriko\b/gi, 'Knitwear'],
  [/\blikral[iı]\b/gi, 'Stretch'],
  [/\bkalite(?:li)?\b/gi, 'Quality'],
  [/\bindirim\b/gi, 'Discount'],
  [/\btoptan\b/gi, 'Wholesale'],
];

// Arabic / non-latin script lines are dropped (supplier notes)
const NON_LATIN_LINE = /[\u0600-\u06FF\u0400-\u04FF]/;

export function cleanIntlText(input?: string | null): string {
  if (!input) return '';
  let out = input.replace(EMOJI_RE, ' ');
  out = out.replace(PRICE_RE, ' ');
  for (const [re, rep] of TR_TERMS) out = out.replace(re, rep);
  out = out
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0 && !NON_LATIN_LINE.test(l))
    .join('\n');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function cleanIntlTitle(input?: string | null): string {
  const cleaned = cleanIntlText(input).replace(/\n+/g, ' ').trim();
  return cleaned || 'Product';
}
