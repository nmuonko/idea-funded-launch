
# Make Language and Quick Links Collapsible Dropdowns

## What Changes

Convert the "Choisir la langue" (Language) section and "Liens rapides" (Quick Links) section in the hamburger menu from always-visible lists into collapsible dropdown sections using Radix Collapsible. This keeps the menu cleaner -- users tap the header to expand/collapse each section.

## Technical Details

### File: `src/components/shop/ShopHeader.tsx`

**1. Add imports:**
- Import `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible`
- Import `ChevronRight` from lucide-react (already imported: `ChevronDown`)

**2. Language section (lines 101-126):**
Replace the static list with a Collapsible. The header "Choisir la langue / Language" becomes a clickable trigger showing the current language flag + name, with a chevron that rotates on open. The language buttons appear inside CollapsibleContent.

```tsx
<Collapsible>
  <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-medium text-white/60 uppercase tracking-wider px-0 py-2 hover:text-white/80 transition-colors">
    <span className="flex items-center gap-2">
      <Globe className="h-4 w-4" />
      {currentLanguage.flag} {shop.selectLanguage || 'Language'}
    </span>
    <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
  </CollapsibleTrigger>
  <CollapsibleContent>
    <div className="space-y-1 mt-2">
      {/* existing language buttons */}
    </div>
  </CollapsibleContent>
</Collapsible>
```

**3. Quick Links section (lines 128-183):**
Same pattern -- wrap in Collapsible. The "Liens rapides" header becomes a clickable trigger with a chevron. All the links (Home, My Orders, Favorites, Support, Share & Earn) go inside CollapsibleContent.

```tsx
<div className="pt-4 border-t border-white/10">
  <Collapsible>
    <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-medium text-white/60 uppercase tracking-wider px-0 py-2 hover:text-white/80 transition-colors">
      <span>{shop.quickLinks}</span>
      <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div className="space-y-1 mt-2">
        {/* existing quick links */}
      </div>
    </CollapsibleContent>
  </Collapsible>
</div>
```

## Summary
- **1 file** changed: `src/components/shop/ShopHeader.tsx`
- Both sections become collapsible dropdowns with animated chevron indicators
- Content stays the same, just wrapped in Collapsible components
