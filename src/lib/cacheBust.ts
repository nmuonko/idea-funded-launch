declare const __BUILD_VERSION__: string;

const BUILD_KEY = 'afrishop_build_version';

export function bustStaleCache(): void {
  try {
    const stored = localStorage.getItem(BUILD_KEY);
    // Always clear on fresh install (stored === null) OR version mismatch
    if (stored === __BUILD_VERSION__) return;

    const prefixes = ['afrishop_cache:', 'afrishop_curated:', 'afrishop_curated_v2:'];
    const exactKeys = ['afrishop_recent_searches', 'afrishop_recently_viewed'];

    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (prefixes.some(p => key.startsWith(p)) || exactKeys.includes(key)) {
        toRemove.push(key);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    localStorage.setItem(BUILD_KEY, __BUILD_VERSION__);

    console.log(`[CacheBust] Cleared ${toRemove.length} stale keys for new deploy`);
  } catch (e) {
    // localStorage unavailable — no-op
  }
}
