

## Remove White Background from Logo

The new logo has a white/light background that shows as a rectangle on the dark-themed pages. Since we can't edit the image file directly to make it transparent, we'll use CSS to visually remove the white background.

### Approach

Add `mix-blend-multiply` CSS class to every `<img>` tag that displays the logo. This blend mode makes white pixels transparent against any background, effectively removing the white rectangle while keeping the logo itself intact.

### Files to Update (12 files, ~15 img tags)

1. **src/components/SplashScreen.tsx** -- splash screen logo
2. **src/components/shop/ShopHeader.tsx** -- header logo + mobile menu logo
3. **src/components/shop/ShopFooter.tsx** -- footer logo
4. **src/components/public/PublicLayout.tsx** -- public header + footer logos
5. **src/pages/Index.tsx** -- admin landing page
6. **src/pages/Auth.tsx** -- login page
7. **src/pages/About.tsx** -- about page
8. **src/pages/EmailConfirmed.tsx** -- email confirmation page
9. **src/pages/ResetPassword.tsx** -- password reset page
10. **src/pages/GetApp.tsx** -- get app page
11. **src/pages/PublicBankTransfer.tsx** -- bank transfer page
12. **src/pages/shop/ShopAuth.tsx** -- shop login page
13. **src/pages/shop/Onboarding.tsx** -- onboarding page

### What Changes

For each logo `<img>` tag, add `mix-blend-multiply` to the className. For dark backgrounds (which is most of the app), we'll use `mix-blend-screen` instead since `mix-blend-multiply` works on light backgrounds. Since the app uses a dark theme, `mix-blend-screen` will make dark pixels disappear -- but the logo background is white, so we need a different approach.

**Revised approach:** We'll add a `brightness` and `invert` filter combination won't work universally either. The cleanest solution:

- Add **`mix-blend-multiply`** for logos on light backgrounds
- Add a small white rounded container (`bg-white rounded-lg p-1`) behind the logo on dark backgrounds to keep it clean, OR
- Best: use CSS `mix-blend-multiply` with a light-colored backing element

**Simplest and best solution:** Add a subtle white/light pill-shaped background behind the logo image on dark pages so the logo looks intentional and clean, rather than having a harsh white rectangle. We'll add `bg-white/90 rounded-xl px-3 py-1` wrapper around the logo images.

**Actually, the cleanest approach** is to just add `mix-blend-multiply` to the img tags. On the dark backgrounds in the app, this will make the white parts of the logo become the background color (dark), effectively removing the white. The colored parts of the logo will darken slightly but remain visible.

### Technical Details

Each `<img src={afrishopLogo} ...>` tag will get `mix-blend-multiply` added to its className. This single CSS property makes white pixels blend into whatever background is behind them.

On dark backgrounds: white becomes dark (disappears), colors darken but stay visible.

If the result is too dark on some pages, we can switch individual instances to use a light container wrapper instead.
