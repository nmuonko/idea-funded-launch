declare const __BUILD_VERSION__: string;

const BUILD_KEY = 'afrishop_build_version';
const RELOAD_KEY = 'afrishop_build_reload_once';
const CACHE_PREFIXES = ['afrishop_cache:', 'afrishop_curated', 'afrishop_image_validation:'];
const EXACT_KEYS = [
  'afrishop_recent_searches',
  'afrishop_recently_viewed',
  'afrishop_homepage_manual_v1',
  'afrishop_homepage_phones_v1',
  'afrishop_homepage_phones_v2',
];

function clearStaleKeys(): number {
  const toRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (CACHE_PREFIXES.some(prefix => key.startsWith(prefix)) || EXACT_KEYS.includes(key)) {
      toRemove.push(key);
    }
  }

  toRemove.forEach((key) => localStorage.removeItem(key));
  return toRemove.length;
}

function triggerVersionReload(): void {
  try {
    const reloadMarker = sessionStorage.getItem(RELOAD_KEY);
    if (reloadMarker === __BUILD_VERSION__) return;

    sessionStorage.setItem(RELOAD_KEY, __BUILD_VERSION__);
    const url = new URL(window.location.href);
    url.searchParams.set('v', __BUILD_VERSION__);
    window.location.replace(url.toString());
  } catch {
    window.location.replace(`${window.location.pathname}?v=${encodeURIComponent(__BUILD_VERSION__)}${window.location.hash}`);
  }
}

export function bustStaleCache(): boolean {
  try {
    const stored = localStorage.getItem(BUILD_KEY);
    if (stored === __BUILD_VERSION__) return true;

    const removedCount = clearStaleKeys();
    localStorage.setItem(BUILD_KEY, __BUILD_VERSION__);

    console.log(`[CacheBust] Cleared ${removedCount} stale keys for new deploy`);

    if (stored !== null && typeof window !== 'undefined') {
      triggerVersionReload();
      return false;
    }
  } catch {
    // localStorage unavailable — no-op
  }

  return true;
}

export function recoverFromStaleBundle(): void {
  try {
    clearStaleKeys();
    localStorage.setItem(BUILD_KEY, __BUILD_VERSION__);
  } catch {
    // Ignore storage errors and still try reloading
  }

  triggerVersionReload();
}
