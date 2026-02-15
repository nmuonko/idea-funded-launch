
# Move Referral to the Hamburger Menu (Quick Links Section)

## What Changes

Remove the floating referral button entirely and add a "Partager & Gagner" link inside the hamburger menu's **Quick Links** section in `ShopHeader.tsx`. This way users find it naturally alongside Home, My Orders, Favorites, and Support.

Tapping the link will open the same bottom drawer with the InviteEarn registration form.

## Technical Details

### 1. Delete the floating button component
- **Remove** `src/components/shop/ReferralFAB.tsx`
- **Remove** the `<ReferralFAB />` import and usage from wherever it's rendered (likely a layout component)

### 2. Add referral entry to ShopHeader.tsx Quick Links

After the Support link (line 165), add a new button that opens a Drawer with InviteEarn:

```tsx
<Drawer>
  <DrawerTrigger asChild>
    <button
      onClick={() => setMobileMenuOpen(false)}
      className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors w-full text-left"
    >
      <Gift className="h-4 w-4" />
      Partager & Gagner
    </button>
  </DrawerTrigger>
  <DrawerContent className="bg-black border-white/10 px-4 pb-8 pt-4 max-h-[85vh] overflow-y-auto">
    <InviteEarn language={language} />
  </DrawerContent>
</Drawer>
```

### 3. Add necessary imports to ShopHeader.tsx
- `Gift` from lucide-react
- `Drawer`, `DrawerTrigger`, `DrawerContent` from `@/components/ui/drawer`
- `InviteEarn` from `@/components/shop/InviteEarn`

## Files Changed
- `src/components/shop/ShopHeader.tsx` -- add referral link in Quick Links section + imports
- `src/components/shop/ReferralFAB.tsx` -- delete file
- Layout file where `<ReferralFAB />` is rendered -- remove import and usage
