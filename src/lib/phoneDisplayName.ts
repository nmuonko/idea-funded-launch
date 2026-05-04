/**
 * Convert long Amazon/eBay phone titles into short, clean catalog labels.
 * Examples:
 *   "Apple iPhone SE (2nd Generation), US Version, 64GB, Black for..." → { name: "iPhone SE 2", storage: "64 Go" }
 *   "Samsung Galaxy S23 5G, 128GB, Phantom Black - Unlocked"           → { name: "Samsung Galaxy S23", storage: "128 Go" }
 */
export interface PhoneDisplayName {
  name: string;
  storage: string | null;
}

const STORAGE_RE = /(\d{2,4})\s?(GB|TB|Go|To)\b/i;

function extractStorage(title: string): string | null {
  const m = title.match(STORAGE_RE);
  if (!m) return null;
  const num = m[1];
  const unit = /tb|to/i.test(m[2]) ? 'To' : 'Go';
  return `${num} ${unit}`;
}

function cleanIphone(title: string): string | null {
  // iPhone SE (2nd/3rd Generation)
  const seGen = title.match(/iphone\s*se[^a-z0-9]*\(?\s*(\d)(?:nd|rd|st|th)?\s*generation\s*\)?/i);
  if (seGen) return `iPhone SE ${seGen[1]}`;
  if (/iphone\s*se/i.test(title)) return 'iPhone SE';

  // iPhone 14 Pro Max / iPhone 13 Pro / iPhone 12 mini / iPhone 15 Plus
  const m = title.match(/iphone\s*(\d{1,2})\s*(pro\s*max|pro|plus|mini)?/i);
  if (m) {
    const num = m[1];
    const variant = m[2]
      ? m[2].toLowerCase().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : '';
    return `iPhone ${num}${variant ? ' ' + variant : ''}`;
  }
  // iPhone XR / XS / X
  const x = title.match(/iphone\s*(xr|xs\s*max|xs|x)\b/i);
  if (x) return `iPhone ${x[1].toUpperCase().replace(/\s+/g, ' ')}`;
  return null;
}

function cleanGalaxy(title: string): string | null {
  // Galaxy S23 Ultra / S23+ / Note 20 / Z Fold 5 / Z Flip 5 / A54 5G
  const z = title.match(/galaxy\s*z\s*(fold|flip)\s*(\d)/i);
  if (z) return `Samsung Galaxy Z ${z[1][0].toUpperCase() + z[1].slice(1).toLowerCase()} ${z[2]}`;
  const note = title.match(/galaxy\s*note\s*(\d{1,2})/i);
  if (note) return `Samsung Galaxy Note ${note[1]}`;
  const s = title.match(/galaxy\s*(s\d{1,2})\s*(ultra|plus|\+)?/i);
  if (s) {
    const variant = s[2] ? (s[2] === '+' ? ' Plus' : ' ' + s[2][0].toUpperCase() + s[2].slice(1).toLowerCase()) : '';
    return `Samsung Galaxy ${s[1].toUpperCase()}${variant}`;
  }
  const a = title.match(/galaxy\s*(a\d{1,2})/i);
  if (a) return `Samsung Galaxy ${a[1].toUpperCase()}`;
  return null;
}

function cleanPixel(title: string): string | null {
  const m = title.match(/pixel\s*(\d)\s*(pro\s*xl|pro|xl|a)?/i);
  if (m) {
    const num = m[1];
    const variant = m[2]
      ? m[2].toLowerCase().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : '';
    return `Google Pixel ${num}${variant ? (variant.toLowerCase() === 'a' ? variant.toLowerCase() : ' ' + variant) : ''}`;
  }
  return null;
}

export function formatPhoneDisplayName(rawTitle: string): PhoneDisplayName {
  const title = (rawTitle || '').trim();
  if (!title) return { name: 'Phone', storage: null };

  const storage = extractStorage(title);
  let name: string | null = null;

  if (/iphone/i.test(title)) name = cleanIphone(title);
  else if (/galaxy|samsung/i.test(title)) name = cleanGalaxy(title);
  else if (/pixel/i.test(title)) name = cleanPixel(title);

  if (!name) {
    // fallback: take first ~5 words, strip trailing punctuation
    name = title
      .split(/[,\-–—|()]/)[0]
      .split(/\s+/)
      .slice(0, 5)
      .join(' ')
      .trim();
  }

  return { name, storage };
}
