
# Prettier "Partager & Gagner" Referral Drawer

The current drawer is functional but visually flat -- plain dark background, no visual hierarchy, and basic form inputs. Here's the redesign plan:

## Visual Improvements

### 1. Add a decorative header section
- Gradient background header (orange-to-yellow) with a large centered Gift icon and animated sparkle effect
- Title in bold white text over the gradient
- Subtitle/description below with better typography and spacing

### 2. Improve the registration form
- Card-style container with subtle glassmorphism (`backdrop-blur`, semi-transparent background)
- Rounded input fields with icons inside (User, Mail, Phone icons as prefixes)
- Better label styling with proper spacing
- The "Obtenir mon lien" button gets a larger size, rounded-full shape, and a subtle shadow/glow effect

### 3. Improve the "link generated" state
- Show a success animation/checkmark when the link is generated
- Display the referral link in a styled card with a gradient border
- Larger, more prominent copy button with animation on click

### 4. Polish the DrawerContent
- Add a subtle handle bar indicator at the top (the small gray pill)
- Rounded top corners with more padding
- Smooth entry animation

## Technical Changes

**Single file**: `src/components/shop/InviteEarn.tsx`

- Add `User, Mail, Phone, Sparkles` imports from lucide-react
- Restructure the JSX layout:
  - Top section: gradient banner with icon and title
  - Middle: description text
  - Bottom: form fields with icon prefixes or the referral link display
- Use Tailwind classes for the gradient header (`bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-400`), glassmorphism on the form card (`bg-white/10 backdrop-blur-md`), and glow on the CTA button (`shadow-[0_0_20px_rgba(249,115,22,0.3)]`)
- Input fields wrapped in a `div` with a leading icon and proper rounded styling

No backend changes needed. No new dependencies required.
