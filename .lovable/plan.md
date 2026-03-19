

## Problem

The `isCapacitorApp()` detection is unreliable. It checks for `window.Capacitor` and "capacitor" in the user agent, but:
- `window.Capacitor` may not be injected yet when auth initializes (timing race)
- Capacitor does NOT add "capacitor" to the user agent by default on all platforms
- Result: mobile users still hit the `signOut()` path at line 250 and get redirected to login

The core design flaw: the code destroys a valid Supabase-persisted session based on app-level flags (`rememberMe`/`sessionActive`) that are inherently fragile in mobile WebViews.

## Fix

**Restructure the auth init logic** to check for an existing valid session BEFORE deciding whether to clear it. Additionally, improve mobile detection with more WebView indicators.

### File: `src/lib/environment.ts`
Expand `isCapacitorApp()` to also detect common mobile WebView patterns (standalone display mode, Android WebView UA strings, iOS WebView indicators):
```typescript
export const isCapacitorApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  // Capacitor bridge object
  if ((window as any).Capacitor !== undefined) return true;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('capacitor')) return true;
  // Android WebView indicators
  if (ua.includes('wv') && ua.includes('android')) return true;
  // iOS standalone (installed to home screen or WebView)
  if ((window.navigator as any).standalone === true) return true;
  // Display-mode standalone (PWA installed)
  if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
  return false;
};
```

### File: `src/contexts/AuthContext.tsx`
Move the session check BEFORE the remember-me clearing logic. If Supabase already has a valid session persisted, don't destroy it — just proceed:

```typescript
// Get session first
const { data: { session: existingSession } } = await supabase.auth.getSession();

const rememberMe = localStorage.getItem('rememberMe');
const sessionActive = sessionStorage.getItem('sessionActive');
const isEmailConfirmPage = window.location.pathname === '/email-confirmed';
const isNativeApp = isCapacitorApp();

// Only clear if: no remember-me, no session flag, not native, not email confirm,
// AND no existing valid session (don't destroy what Supabase already persisted)
if (!rememberMe && !sessionActive && !isEmailConfirmPage && !isNativeApp && !existingSession) {
  console.log('[Auth] No stored session and no remember-me — skipping');
  setLoading(false);
  return;
}

// If flags are missing but session exists (e.g. mobile), just use the session
if (existingSession && !rememberMe && !sessionActive) {
  sessionStorage.setItem('sessionActive', 'true');
}
```

This removes the destructive `signOut()` call entirely for users who have a valid session. The remember-me logic only applies when there's truly no session at all.

### Technical Details

| Item | Detail |
|------|--------|
| Files changed | `src/lib/environment.ts`, `src/contexts/AuthContext.tsx` |
| Root cause | `isCapacitorApp()` fails silently; valid sessions are destroyed |
| Key change | Check for existing session before clearing; never sign out a user who has a valid persisted session |
| Risk | Low — preserves existing behavior for web users without sessions |
| Mobile build compatibility | No native changes needed — works with frozen .aab builds |

