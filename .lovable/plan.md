

## Replace AfriShop Logo Across the App

The new logo (AfriShop USA with Africa map) will replace the current logo in all 12 files that reference it.

### Approach

Since every file imports the logo from the same path (`@/assets/afrishop-logo.png`), the simplest approach is:

1. **Copy the new logo** (`logo_Afrishop_usa_2.JPG`) to `src/assets/afrishop-logo.png`, overwriting the old file
2. **No code changes needed** -- all 12 components already import from `@/assets/afrishop-logo.png`, so they will automatically pick up the new image

### Files that will automatically update (no code changes):
- `src/components/SplashScreen.tsx`
- `src/components/shop/ShopHeader.tsx`
- `src/components/shop/ShopFooter.tsx`
- `src/components/public/PublicLayout.tsx`
- `src/pages/Index.tsx`
- `src/pages/Auth.tsx`
- `src/pages/About.tsx`
- `src/pages/EmailConfirmed.tsx`
- `src/pages/ResetPassword.tsx`
- `src/pages/GetApp.tsx`
- `src/pages/PublicBankTransfer.tsx`
- `src/pages/shop/ShopAuth.tsx`
- `src/pages/shop/Onboarding.tsx`

### Note
The new logo has a white background. On the dark-themed pages, this may appear as a white rectangle. If needed, we can add CSS to handle transparency after the swap.

