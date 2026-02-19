

# Add Two New Homepage Grid Sections: Sound/Audio and Clothing

## What's Changing

Two new category grid cards will be added to the homepage, without modifying any existing logic.

## New Categories

### 1. Sound & Audio ("Son & Audio")
- Covers: Bose speakers, JBL, Bluetooth speakers, headphones, soundbars, home theater, subwoofers, guitar amps, audio equipment
- Keywords: `bose`, `jbl`, `bluetooth speaker`, `soundbar`, `subwoofer`, `home theater`, `audio`, `speaker system`, `wireless speaker`, `portable speaker`, `headphones`, `amplifier`
- Excludes: `sofa`, `bed`, `mattress`, `phone case`, `car charger`

### 2. Clothing ("Mode & Vetements")
- Note: A `clothing` category already exists in the code but may not be rendering visibly or may be getting filtered. This will ensure it appears prominently.
- If it's already showing, we'll add a second fashion-focused variant like "Streetwear & Sneakers" or simply ensure the existing one is populated.

## Technical Changes (single file: `src/pages/shop/ShopHome.tsx`)

1. **Add `sound_audio` to `CATEGORY_TITLE_MAP`**: `{ fr: 'Son & Audio', en: 'Sound & Audio' }`
2. **Add `sound_audio` to `CATEGORY_KEYWORDS`**: bose, jbl, bluetooth speaker, soundbar, subwoofer, home theater, portable speaker, wireless speaker, speaker system, headphones over-ear, studio monitor, amplifier, receiver
3. **Add `sound_audio` to `CATEGORY_EXCLUDE_KEYWORDS`**: sofa, bed, phone case, car charger, mattress, toy, lego
4. **Add `sound_audio` to `ALL_HOMEPAGE_CATEGORIES`** array (appended after collectibles)
5. **Verify `clothing` is in `ALL_HOMEPAGE_CATEGORIES`** (it already is -- no change needed, but we confirm it renders with 4 items via the existing backfill pipeline)

No backend changes needed. The existing 4-step backfill pipeline and general product pool will populate these new grids automatically.

