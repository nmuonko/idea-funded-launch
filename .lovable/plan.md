
# Smart Download Landing Page (`/get`)

## Overview
Create a new lightweight, fully localized landing page at `/get` with Android auto-redirect, reusing the existing dark theme and i18n system. Add `/download` as a redirect alias to `/get` (replacing the current heavy Download page import at that route).

## New File: `src/pages/GetApp.tsx`

A single-page component with:

- **Dark theme** matching existing AfriShop style (black bg, gradient accents)
- **Centered card** with:
  - AfriShop logo (`/favicon.png`)
  - Localized title and subtitle
  - Primary button: Android Play Store link (same tab)
  - Secondary button: Open website link (same tab)
  - Helper text below buttons
  - WhatsApp support button (using `SUPPORT_WHATSAPP_E164` from `supportConfig.ts`)
- **Android auto-redirect**: Detects Android via `navigator.userAgent`, starts 2-second countdown, shows cancel link. If cancelled, stops. If not Android, no countdown.
- **SEO**: Sets `document.title` and meta description via `useEffect`, both localized.
- Uses `useLanguage()` hook -- updates instantly when user changes language from the global selector.
- No header/footer needed (minimal QR landing page), but the global `LanguageSwitcher` should be accessible. We'll add a small floating language selector in the top-right corner of the page itself (reusing the existing `LanguageSwitcher` component).

## Translations: `src/lib/i18n/translations.ts`

Add a `download` section to all 4 languages (en, fr, sw, ln):

| Key | FR (default) | EN |
|---|---|---|
| `download.pageTitle` | Telecharger AfriShop | Download AfriShop |
| `download.metaDescription` | Telechargez l'application AfriShop... | Download the AfriShop app... |
| `download.title` | Obtenez AfriShop | Get AfriShop |
| `download.subtitle` | Achetez depuis les USA, livrez en Afrique | Shop from the USA, deliver to Africa |
| `download.androidButton` | Telecharger l'app Android | Download Android App |
| `download.webButton` | Ouvrir le site web | Open the Website |
| `download.helper` | Vous pouvez choisir l'app ou le site. | You can choose the app or the website. |
| `download.redirecting` | Redirection vers Google Play dans {seconds}s... | Redirecting to Google Play in {seconds}s... |
| `download.cancelRedirect` | Annuler la redirection | Cancel redirect |
| `download.supportTitle` | Aide / Support | Help / Support |
| `download.whatsapp` | Contacter sur WhatsApp | Contact on WhatsApp |

Same pattern for Swahili and Lingala translations.

## Routes: `src/App.tsx`

- Add route: `/get` rendering `GetApp`
- Change `/download` from rendering `DownloadPage` to `<Navigate to="/get" replace />`
- Add `/get` to the `publicPaths` array so the splash screen is skipped

## Technical Details

### Android Detection
```typescript
const isAndroid = /android/i.test(navigator.userAgent);
```

### Countdown Logic
- `useState` for `countdown` (starts at 2) and `cancelled` flag
- `useEffect` with `setInterval` decrementing every second
- When countdown reaches 0 and not cancelled: `window.location.href = playStoreUrl`
- Cancel button sets `cancelled = true`

### Play Store URL
```
https://play.google.com/store/apps/details?id=com.afrishop.usadrc
```

### Files Changed
| File | Change |
|---|---|
| `src/pages/GetApp.tsx` | New file -- the landing page |
| `src/lib/i18n/translations.ts` | Add `download` section to all 4 languages |
| `src/App.tsx` | Add `/get` route, redirect `/download` to `/get`, update publicPaths |
