

# Fix: Web Recipe Seeds Mismatch

## Problem

The **web** `home_recipe_seeds` are completely scrambled -- each category's web seeds belong to a different category. This means when you "Rebuild" a web section from the admin portal, it fetches products using the wrong search queries. The mobile seeds are correct.

### Current Web Seed Assignments (WRONG)

| Recipe Key | Currently Has Seeds For | Should Have |
|---|---|---|
| clothing | Gaming (VR headset, Xbox games, PS5 controller...) | Clothing (sneakers, hoodie, jacket...) |
| gaming | Clothing (sneakers, handbag, jacket, boots...) | Gaming (PS5, Xbox, Nintendo...) |
| vehicles | Home items (sofa, vacuum, mattress, bookshelf...) | Vehicles (BMW, Toyota, Ford...) |
| phones | Mixed (MacBook, PS5, smart TV...) | Phones (iPhone, Samsung, Pixel...) |
| parts_accessories | Household (air fryer, skin care, robot vacuum...) | Parts (car charger, phone case, dashcam...) |

The mobile seeds AND the `home_section_seeds` (used by Publish) are both correct -- only the web `home_recipe_seeds` are affected.

## Root Cause

The web recipe seeds were likely inserted with mismatched `recipe_id` values, causing each category to pull from another category's seed list.

## Fix Plan

### Step 1: Delete all incorrect web recipe seeds

Remove all `home_recipe_seeds` rows linked to web recipes for the affected categories: `clothing`, `gaming`, `vehicles`, `phones`, and `parts_accessories`.

### Step 2: Re-insert correct web seeds

Insert properly matched seeds for each web recipe, aligned with the correct `recipe_id`. The correct seeds will mirror the `home_section_seeds` table (which is already correct):

- **phones (web)**: iPhone unlocked, Samsung Galaxy, Google Pixel, iPhone 15, Samsung S24 Ultra, etc.
- **vehicles (web)**: BMW X5, Toyota Camry, Ford Explorer, Honda CR-V, Tesla Model Y, etc.
- **gaming (web)**: PS5 console, Xbox Series X, Nintendo Switch, gaming laptop, Steam Deck, gaming monitor, etc.
- **clothing (web)**: Nike sneakers, hoodie, jacket winter, men sneakers, women boots, sunglasses, etc.
- **parts_accessories (web)**: car phone mount, dashcam, phone case, screen protector, car charger, etc.

### Step 3: Verify homepage and other correct seeds

Confirm that `homepage`, `electronics`, `home_garden`, `toys`, `sporting_goods`, and `refurbished` web seeds are correctly mapped (they appear fine from the data).

### No-Regression Safeguards

- No edge function code changes required.
- No frontend code changes.
- Only database seed data is corrected.
- Mobile seeds remain untouched.
- The `home_section_seeds` table (used by Publish) is not modified.
- After fixing, a "Rebuild" from admin will produce correct results matching each category.

