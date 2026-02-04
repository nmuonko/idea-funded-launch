

# Replace Carousel with Delivery Banner Image

This plan removes the FeaturedCarousel and replaces it with an attractive hero banner showing the 2-4 week delivery promise.

---

## Changes Overview

| Task | Description |
|------|-------------|
| Remove FeaturedCarousel | Delete import and usage from ShopHome.tsx |
| Create DeliveryHeroBanner | New component with attractive shipping visual |
| Generate AI Image | Use Lovable AI to create airplane + packages illustration |
| Update translations | Add banner text for all 4 languages |

---

## New Component: DeliveryHeroBanner

**File:** `src/components/shop/DeliveryHeroBanner.tsx`

This component displays an attractive banner with:
- AI-generated image of airplane with packages/cartons
- "2-4 Weeks Delivery" headline
- Subtext explaining USA to DRC shipping
- Dark theme matching the shop design
- Responsive layout (image adapts to mobile/desktop)

```text
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  [AI-Generated Image: Airplane + Packages Flying]          │
│                                                            │
│           🚀 Delivery in 2-4 Weeks                        │
│     From the USA, straight to your door in DRC            │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Design Features:
- Full-width banner with gradient overlay
- Centered text with drop shadows for readability
- Subtle animation on scroll (fade in)
- Clean, modern aesthetic matching shop theme
- Mobile-optimized height and text sizing

---

## AI Image Generation

Using the Lovable AI image generation API (google/gemini-2.5-flash-image), we'll generate an attractive illustration showing:
- A cargo airplane flying through clouds
- Packages/cartons floating or being delivered
- Blue sky gradient background
- Modern, stylized illustration style

The image will be generated once and stored in the Supabase storage bucket, then referenced by URL in the component.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/shop/ShopHome.tsx` | Remove FeaturedCarousel, add DeliveryHeroBanner |
| `src/components/shop/FeaturedCarousel.tsx` | Can be deleted (optional cleanup) |
| `src/lib/i18n/translations.ts` | Add delivery banner text |

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/shop/DeliveryHeroBanner.tsx` | New hero banner component |

---

## Implementation Details

### DeliveryHeroBanner.tsx Structure

```typescript
import { motion } from 'framer-motion';
import { Plane, Package } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

export function DeliveryHeroBanner() {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl mx-4 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700"
    >
      {/* Background Image */}
      <img 
        src="/delivery-hero-banner.png" 
        alt="Fast delivery"
        className="absolute inset-0 w-full h-full object-cover opacity-40"
      />
      
      {/* Content Overlay */}
      <div className="relative z-10 flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="flex items-center gap-2 mb-3">
          <Plane className="h-8 w-8 text-white" />
          <Package className="h-6 w-6 text-white/80" />
        </div>
        
        <h2 className="text-2xl md:text-3xl font-bold text-white drop-shadow-lg">
          {shop.deliveryIn2To4Weeks || "Delivery in 2-4 Weeks"}
        </h2>
        
        <p className="text-white/90 mt-2 max-w-md text-sm md:text-base">
          {shop.deliverySubtext || "From the USA, straight to your door in DRC"}
        </p>
      </div>
      
      {/* Decorative elements */}
      <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-white/5 blur-2xl" />
    </motion.div>
  );
}
```

### ShopHome.tsx Changes

Remove:
```typescript
import { FeaturedCarousel } from '@/components/shop/FeaturedCarousel';
```

Replace:
```typescript
import { DeliveryHeroBanner } from '@/components/shop/DeliveryHeroBanner';
```

And change the JSX from:
```tsx
<FeaturedCarousel />
```

To:
```tsx
<DeliveryHeroBanner />
```

### Translation Keys (add to all 4 languages)

```typescript
// English
deliveryIn2To4Weeks: "Delivery in 2-4 Weeks",
deliverySubtext: "From the USA, straight to your door in DRC",

// French
deliveryIn2To4Weeks: "Livraison en 2-4 Semaines",
deliverySubtext: "Des États-Unis, directement chez vous en RDC",

// Swahili
deliveryIn2To4Weeks: "Uwasilishaji katika Wiki 2-4",
deliverySubtext: "Kutoka Marekani, moja kwa moja hadi mlango wako DRC",

// Lingala
deliveryIn2To4Weeks: "Livraison na Bapɔsɔ 2-4",
deliverySubtext: "Uta États-Unis, tii na ndako na yo na RDC",
```

---

## Image Generation Strategy

Since we need an attractive visual, we have two options:

**Option A: AI-Generated Image (Recommended)**
- Use the Lovable AI gateway to generate a custom illustration
- Prompt: "Modern flat illustration of a cargo airplane flying through blue sky with colorful shipping boxes and packages floating around it, vibrant blue and purple gradient background, e-commerce delivery concept, clean minimal style"
- Store the generated image in Supabase storage
- Reference by public URL

**Option B: Fallback with Icons + Gradient**
- If image generation fails, use a gradient background with Lucide icons (Plane, Package, Truck)
- This is already built into the component as a fallback

---

## Expected Result

1. Carousel is completely removed
2. Clean hero banner shows delivery promise prominently
3. Attractive visual with airplane/packages theme
4. Fully localized in 4 languages
5. Responsive design for mobile and desktop
6. Matches the dark shop theme aesthetic

