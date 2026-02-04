
# Fix Web Shop: i18n, Dynamic Carousel & Header Layout

## Issues to Fix

Based on your feedback and the screenshot, I need to address three main issues:

1. **Language Selection Not i18n**: The current language dropdown changes the language state but the shop UI text is not using translations - placeholders, labels, and menu items remain in English
2. **Static Carousel**: The FeaturedCarousel shows hardcoded product names instead of real products from Amazon/eBay
3. **Header Layout Wrong**: Language, Cart, and Account buttons should be on the LEFT side (after logo), with search bar taking up more space on the RIGHT

---

## Solution Overview

```text
CURRENT HEADER LAYOUT (Wrong):
┌─────────────────────────────────────────────────────────────┐
│  ☰  Logo  [────── Search Bar ──────]  🌐  🛒  👤          │
└─────────────────────────────────────────────────────────────┘

CORRECT HEADER LAYOUT:
┌─────────────────────────────────────────────────────────────┐
│  ☰  Logo  🌐  🛒  👤  [───────── Search Bar ─────────]     │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical Plan

### 1. Add Shop-Specific i18n Translations

**File: `src/lib/i18n/translations.ts`**

Add a new `shop` section to each language with all UI strings:

```typescript
// Add to each language (en, fr, sw, ln):
shop: {
  // Header
  searchPlaceholder: 'Search millions of products...',
  filtersAndMenu: 'Filters & Menu',
  selectLanguage: 'Select Language',
  signIn: 'Sign In',
  
  // Categories
  allCategories: 'All Categories',
  electronics: 'Electronics',
  vehicles: 'Vehicles',
  clothingFashion: 'Clothing & Fashion',
  homeGarden: 'Home & Garden',
  toysGames: 'Toys & Games',
  sportsOutdoors: 'Sports & Outdoors',
  jewelryWatches: 'Jewelry & Watches',
  
  // Price ranges
  anyPrice: 'Any Price',
  under50: 'Under $50',
  // ... etc
  
  // Home page
  heroTitle: 'Shop the U.S.',
  heroSubtitle: 'Delivered to Africa',
  heroDescription: 'Browse millions of products from Amazon & eBay',
  seeAll: 'See All',
  searchProducts: 'Search Products',
  dontSeeWhatYoureLookingFor: "Don't see what you're looking for?",
  
  // Quick links
  home: 'Home',
  myOrders: 'My Orders',
  support: 'Support',
  
  // Sections
  category: 'Category',
  priceRange: 'Price Range',
  quickLinks: 'Quick Links',
  recentSearches: 'Recent Searches',
  clear: 'Clear',
  
  // Product
  addToCart: 'Add to Cart',
  outOfStock: 'Out of Stock',
  
  // Cart
  cart: 'Cart',
  checkout: 'Checkout',
  emptyCart: 'Your cart is empty',
  
  // Featured carousel
  featured: 'Featured',
  shopNow: 'Shop Now',
}
```

**French translations:**
```typescript
shop: {
  searchPlaceholder: 'Rechercher des millions de produits...',
  filtersAndMenu: 'Filtres et Menu',
  selectLanguage: 'Choisir la langue',
  signIn: 'Connexion',
  allCategories: 'Toutes les catégories',
  electronics: 'Électronique',
  vehicles: 'Véhicules',
  // ... etc
  heroTitle: 'Achetez aux États-Unis',
  heroSubtitle: 'Livré en Afrique',
  heroDescription: 'Parcourez des millions de produits Amazon et eBay',
}
```

---

### 2. Update ShopHeader Layout

**File: `src/components/shop/ShopHeader.tsx`**

Restructure the header to put actions on the LEFT, search on the RIGHT:

```typescript
<div className="flex items-center gap-2">
  {/* Left Side: Menu + Logo + Language + Cart + Account */}
  <Sheet>...</Sheet>
  
  <Link to="/shop">
    <img src={afrishopLogo} alt="AfriShop" className="h-8" />
  </Link>
  
  {/* Language Selector */}
  <DropdownMenu>
    <DropdownMenuTrigger>
      <Button>
        <Globe /> {currentLanguage.flag}
      </Button>
    </DropdownMenuTrigger>
    ...
  </DropdownMenu>
  
  {/* Cart */}
  <CartDrawer />
  
  {/* Auth */}
  {user ? <Link to="/profile">...</Link> : <Link to="/auth">...</Link>}
  
  {/* Search Bar - Now takes remaining space on the right */}
  <div className="flex-1 ml-4">
    <SearchBar className="w-full" />
  </div>
</div>
```

---

### 3. Apply i18n to All Shop Components

**Files to update:**
- `ShopHeader.tsx` - Use `t.shop.searchPlaceholder`, `t.shop.signIn`, etc.
- `SearchBar.tsx` - Use `t.shop.searchPlaceholder`, `t.shop.recentSearches`
- `ShopHome.tsx` - Use `t.shop.heroTitle`, `t.shop.seeAll`, etc.
- `CategoryTabs.tsx` - Use `t.shop.electronics`, etc.
- `CartDrawer.tsx` - Use `t.shop.cart`, `t.shop.checkout`
- `FeaturedCarousel.tsx` - Load real products instead of static data

---

### 4. Make FeaturedCarousel Load Real Products

**File: `src/components/shop/FeaturedCarousel.tsx`**

Instead of hardcoded items, fetch from the catalog-search API with premium search terms:

```typescript
export function FeaturedCarousel() {
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFeaturedProducts = async () => {
      // Search for high-value items
      const featuredQueries = [
        'iPhone 16 Pro Max',
        'luxury car Mercedes BMW',
        'Xbox Series X',
        'Apple Vision Pro',
        'MacBook Pro M4',
        'PlayStation 5'
      ];
      
      try {
        // Fetch one product per query
        const results = await Promise.all(
          featuredQueries.map(query => 
            supabase.functions.invoke('catalog-search', {
              body: { query, limit: 1 }
            })
          )
        );
        
        // Extract first product from each result
        const products = results
          .map(r => r.data?.items?.[0])
          .filter(Boolean)
          .map(item => ({
            id: item.provider_product_id || item.id,
            provider: item.provider,
            title: item.title,
            imageUrl: item.image_url || item.imageUrl,
            priceUsd: item.price_usd || item.priceUsd,
            gradient: getGradientForCategory(item.unified_category),
          }));
        
        setFeaturedProducts(products);
      } catch (err) {
        console.error('Failed to fetch featured products:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFeaturedProducts();
  }, []);

  // Render carousel with REAL product images and titles
  return (
    <div className="relative overflow-hidden py-4">
      <motion.div className="flex gap-4 px-4" animate={{...}}>
        {featuredProducts.map((product, index) => (
          <Link 
            key={`${product.id}-${index}`}
            to={`/shop/product/${product.provider}/${encodeURIComponent(product.id)}`}
          >
            <motion.div className={`relative w-64 h-32 rounded-2xl bg-gradient-to-r ${product.gradient}`}>
              {/* Real product image */}
              <img 
                src={product.imageUrl} 
                alt={product.title}
                className="absolute right-2 bottom-2 h-24 w-24 object-contain"
              />
              
              {/* Product title */}
              <div className="relative z-10 p-4">
                <h3 className="text-lg font-bold text-white">
                  {product.title?.substring(0, 25)}...
                </h3>
                <p className="text-sm text-white/80">
                  ${product.priceUsd?.toFixed(2)}
                </p>
              </div>
            </motion.div>
          </Link>
        ))}
      </motion.div>
    </div>
  );
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/i18n/translations.ts` | Add `shop` section with all UI strings for all 4 languages |
| `src/components/shop/ShopHeader.tsx` | 1) Move Language/Cart/Account to left side, 2) Use i18n translations |
| `src/components/shop/SearchBar.tsx` | Use `t.shop.searchPlaceholder` and `t.shop.recentSearches` |
| `src/components/shop/FeaturedCarousel.tsx` | Fetch real products from catalog-search API |
| `src/pages/shop/ShopHome.tsx` | Use i18n translations for hero text and section labels |
| `src/components/shop/CategoryTabs.tsx` | Use i18n translations for category names |
| `src/components/shop/CartDrawer.tsx` | Use i18n translations |

---

## Translation Keys to Add (Summary)

| Key | English | French |
|-----|---------|--------|
| `shop.searchPlaceholder` | "Search millions of products..." | "Rechercher des millions de produits..." |
| `shop.heroTitle` | "Shop the U.S." | "Achetez aux États-Unis" |
| `shop.heroSubtitle` | "Delivered to Africa" | "Livré en Afrique" |
| `shop.seeAll` | "See All" | "Voir tout" |
| `shop.signIn` | "Sign In" | "Connexion" |
| `shop.cart` | "Cart" | "Panier" |
| `shop.checkout` | "Checkout" | "Paiement" |
| `shop.addToCart` | "Add to Cart" | "Ajouter au panier" |
| `shop.electronics` | "Electronics" | "Électronique" |
| `shop.vehicles` | "Vehicles" | "Véhicules" |
| ... | ... | ... |

---

## Search i18n (Already Works!)

The backend already handles French searches via the `searchRewriter.ts` system. When a user types "téléphone portable samsung" it gets automatically rewritten to "samsung mobile phone" before querying Amazon/eBay. No frontend changes needed for this - it already works.

---

## Expected Result

After these changes:
1. Header layout matches your reference image (actions on left, search prominent on right)
2. All shop UI text uses i18n translations and changes when language is selected
3. Featured carousel shows REAL product images and prices from Amazon/eBay
4. French users see French UI and their French searches work correctly (already supported by backend)
