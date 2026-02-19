

# Auto-Scrolling Horizontal Product Rows (Amazon-Style)

## What Changes

Replace the static grid inside each `SectionBlock` with the existing `HorizontalProductRow` component, and add **auto-scrolling** so products continuously scroll sideways like a ticker/carousel. Each section becomes a titled dark card with a horizontally scrolling row of products that moves on its own and pauses on hover/touch.

## Changes

### 1. Add Auto-Scroll to `HorizontalProductRow.tsx`
- Add a `useEffect` that auto-scrolls the container to the right every ~3 seconds
- When it reaches the end, loop back to the start
- Pause auto-scroll on hover (desktop) and on touch (mobile)
- Keep the manual left/right arrow buttons

### 2. Update `SectionBlock.tsx` to Use Horizontal Rows
- Replace the `grid` layout with the `HorizontalProductRow` component
- Keep the dark card wrapper (`bg-white/[0.04]`) and section title
- Remove `maxItems` cap so all products in a section are scrollable
- Pass all items to the horizontal row

### 3. Update Fade Overlays
- Change fade gradient from `from-black` to `from-[rgb(10,10,10)]` to match the dark card background better

## Files Modified

| File | Change |
|------|--------|
| `src/components/shop/HorizontalProductRow.tsx` | Add auto-scroll interval with pause on hover/touch |
| `src/components/shop/SectionBlock.tsx` | Replace grid with `HorizontalProductRow`, keep dark card wrapper + title |

