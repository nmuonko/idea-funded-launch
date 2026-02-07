
# Fix Gaming Tab Returning Irrelevant Items

## Root Cause

The gaming scorer at line 137-143 of `searchIntentScorer.ts` has two problems:

1. **Too-broad boost keyword**: `"gaming"` in the boost list matches anything with "gaming" in the title (e.g., "Gaming Device Scripts Mods"), so accessories score high instead of being dropped.
2. **No relevance gate**: Items like "Premium Fort for Sale" and "MINECRAFT MCDONALDS NETHER SAUCE" ($49,000) pass through because they don't match any drop keyword. There is no requirement that an item must contain at least one console/game signal to survive.
3. **No price sanity check**: Real consoles cost $200-$800. Items at $2,000-$49,000 are clearly not consoles or games.

## Changes (1 file)

### `supabase/functions/_shared/searchIntentScorer.ts` (lines 137-143)

Replace the gaming case with stricter logic:

```typescript
case "gaming": {
  // Drop accessories, merch, and cheat devices
  if (hasAny(title, [
    "case","cover","skin","sticker","decal","poster","shirt","shoes",
    "bag","backpack","hat","cap","mug","cup","keychain","wallet","socks",
    "figurine","mod","script","adapter","converter","device scripts",
    "sauce","fort for sale","mcdonalds","premium fort",
  ])) return null;

  // Must contain at least one actual gaming signal to survive
  const GAMING_SIGNALS = [
    "console","xbox","playstation","ps5","ps4","ps3","nintendo","switch",
    "gamepad","controller","video game","xbox series","series x","series s",
    "wii","gamecube","sega","atari","game boy","3ds","steam deck","rog ally",
    "game disc","game lot","game collection","game bundle",
  ];
  if (!hasAny(title, GAMING_SIGNALS)) return null;

  // Price sanity: real consoles/games cost under $2000
  if (priceUsd > 2000) return null;

  // Boost known console terms
  if (hasAny(title, ["console","xbox","playstation","ps5","nintendo","switch","steam deck"])) score += 15;
  break;
}
```

Key improvements:
- **Relevance gate**: Items MUST contain at least one gaming signal (console name, "video game", etc.) or they are dropped. This kills "Premium Fort for Sale" and "NETHER SAUCE".
- **Expanded drop list**: Adds "mod", "script", "device scripts", "adapter", "converter" to catch cheat devices like "Titan Two".
- **Price cap at $2,000**: Drops absurdly priced non-gaming items.
- **Removed "gaming" from boost list**: Too generic -- matches accessories. Only specific console names boost score.

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/searchIntentScorer.ts` | Strict gaming relevance gate, price cap, expanded drop list |

## Expected Result
- Gaming tab shows only actual consoles (Xbox, PS5, Nintendo Switch) and video games
- Items like cheat devices, sauces, forts, and $49K junk are dropped
