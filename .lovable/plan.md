

# Fix Wrong Items + Guarantee 4 Items Per Grid

## Root Cause

The `pickExcludeOnly` helper (used for dedicated backend feeds) skips include-keyword checks entirely. This means ANY item from the backend feed passes through as long as it doesn't match an exclude term. Since exclude lists are incomplete (e.g., cameras_photo doesn't exclude "iphone" or "laptop"), wrong items leak in:
- Cameras shows iPhones and gaming laptops
- Beauty shows phone cases
- Parts Auto shows screen protectors
- Some grids only show 2 items because the wrong items consumed dedup slots

## Solution (single file: `src/pages/shop/ShopHome.tsx`)

### 1. Remove `pickExcludeOnly` entirely -- use `pickStrict` everywhere

Delete the `pickExcludeOnly` helper function. Change `buildGrid4` to use `pickStrict` for BOTH dedicated feeds AND accueil pool. This guarantees every item in every grid matches at least one include keyword for that category.

### 2. Broaden include keywords to prevent under-filling

The reason strict matching previously caused empty grids was overly narrow keywords. Add broader terms:

- **cameras_photo**: Add `camera`, `photo`, `photography`, `lumix`, `leica`, `olympus`, `panasonic camera`, `flash`, `studio light`, `softbox`, `backdrop`
- **beauty_health**: Add `beauty`, `health`, `cream`, `body wash`, `soap`, `deodorant`, `hair`, `skin`, `nail`, `brush`, `curling iron`, `straightener`, `derma`, `sunscreen`, `anti-aging`, `cleanser`, `toner`, `mascara`, `eyeshadow`, `blush`, `concealer`, `primer`
- **parts_accessories**: Add `car accessory`, `vehicle part`, `engine`, `muffler`, `caliper`, `rotor`, `gasket`, `clutch`, `differential`, `suspension`, `tie rod`, `ball joint`, `sway bar`, `power steering`, `water pump`, `oxygen sensor`, `mass air flow`, `ignition coil`
- **home_garden**: Add `kitchen`, `living room`, `garden`, `patio`, `outdoor`, `indoor`, `planter`, `grill`, `lawn`, `mower`, `fan`, `heater`, `humidifier`, `dehumidifier`, `iron`, `toaster`, `mixer`, `food processor`, `pressure cooker`, `instant pot`, `air fryer`, `slow cooker`
- **clothing**: Add `apparel`, `outfit`, `fashion`, `wear`, `garment`, `uniform`, `vest`, `cape`, `poncho`, `scarf`, `shawl`, `hat`, `cap`, `glove`, `belt`, `tie`, `tuxedo`, `kimono`, `dashiki`, `boubou`
- **sporting_goods**: Add `sport`, `athletic`, `exercise`, `outdoor`, `football`, `baseball`, `volleyball`, `cricket`, `boxing`, `martial arts`, `swimming`, `surfboard`, `skateboard`, `roller skate`, `helmet`, `knee pad`, `elbow pad`, `resistance band`, `jump rope`, `pull up bar`, `bench press`, `weight`, `barbell`, `kettlebell`
- **electronics**: Add `electronic`, `tech`, `gadget`, `smart home`, `alexa`, `echo`, `google home`, `fire stick`, `chromecast`, `apple tv`, `roku`, `modem`, `switch`, `network`, `server`, `nas`, `external drive`, `flash drive`, `usb hub`, `power strip`, `ups`, `surge protector`
- **collectibles**: Add `collection`, `limited edition`, `signed`, `autograph`, `first edition`, `mint condition`, `graded`, `psa`, `cgc`, `funko pop`, `hot toys`, `statue`, `bust`, `replica`, `prop`
- **refurbished**: Add `pre-owned`, `used`, `open box`, `like new`, `grade a`, `grade b`, `restored`, `geek squad certified`

### 3. Add cross-category excludes that are currently missing

Add to exclude lists to plug remaining holes:

- **cameras_photo**: Add `iphone`, `samsung galaxy`, `laptop`, `macbook`, `gaming`, `alienware`, `msi`, `dell`, `lenovo`, `asus`, `acer`, `hp pavilion`, `tablet`, `ipad`, `android`, `smartphone`, `phone`, `cellphone`
- **beauty_health**: Add `phone`, `iphone`, `samsung`, `case`, `protector`, `laptop`, `computer`, `tablet`, `gaming`
- **parts_accessories**: Add `screen protector`, `tempered glass`, `phone`, `tablet`, `laptop`, `iphone`, `samsung`
- **home_garden**: Add `phone`, `iphone`, `samsung`, `laptop`, `tablet`
- **audio_music**: Add `phone`, `iphone`, `samsung`, `laptop`, `tablet`, `camera`, `lens`

### 4. Top-up fetches for ALL 16 categories (not just short ones)

Currently the top-up only fires for categories with <4 items. Change it to fire for ALL categories so we always have a deep pool to pick from. This ensures that even if the initial strict pass gets 2-3 items, the top-up pool provides enough candidates to reach 4.

Change the useEffect trigger: instead of `shortCats = categoryGrids.filter(g => g.items.length < 4)`, fetch pools for ALL categories. This pre-warms the pools so `finalCategoryGrids` can always fill to 4.

### 5. Fix `finalCategoryGrids` to use strict filtering on top-up pool too

Currently uses exclude-only on top-up pool items. Change to use the same strict include+exclude logic, since we've now broadened include keywords enough.

### 6. Fix CategoryCard to show skeleton instead of disappearing

`CategoryCard` returns `null` when `items.length === 0` (line 33). The `SectionBlock` already passes `loading={items.length === 0}` which shows a skeleton. But the `CategoryCard` checks items before checking loading. Fix: check loading FIRST, then check items.

This is already handled correctly (lines 17-31 check loading before line 33 checks items.length). So this is fine as long as we pass `loading={true}` when items are empty.

## Summary of Changes

All in `src/pages/shop/ShopHome.tsx`:
1. Delete `pickExcludeOnly` helper
2. Update `buildGrid4` to use `pickStrict` for both dedicated feeds and accueil pool  
3. Expand `CATEGORY_KEYWORDS` with broader include terms for all 16 categories
4. Expand `CATEGORY_EXCLUDE_KEYWORDS` with missing cross-category terms
5. Change top-up effect to fetch ALL categories (not just short ones)
6. Change `finalCategoryGrids` to use strict include+exclude on top-up items

No backend changes. No layout changes. No other files.

