

# Combine Mobile and Web Homepage into Side-by-Side Tabs

## What Changes

Replace the two separate "Mobile Homepage" and "Web Homepage" cards (lines 412-495) with a single card that has **two tabs side by side**: "Mobile App" and "Web App", similar to the Payment Settings layout (Fournisseurs / Limites / Support).

## Layout

```text
+----------------------------------------------------------+
| Home Curation                          [Publish All]      |
+----------------------------------------------------------+
| [Mobile App]  [Web App]                                   |
|----------------------------------------------------------|
| (content for selected tab: recipe list + rebuild button)  |
+----------------------------------------------------------+
```

## Technical Details

**File: `src/pages/admin/HomeRecipes.tsx`**

- Import `Tabs, TabsList, TabsTrigger, TabsContent` from `@/components/ui/tabs`
- Replace the two separate `<Card>` blocks (Mobile Homepage at line 412 and Web Homepage at line 454) with a single `<Card>` containing:
  - A `<Tabs>` component with `defaultValue="mobile"`
  - A `<TabsList>` with two triggers: "Mobile App" (with Smartphone icon) and "Web App" (with Globe icon)
  - Two `<TabsContent>` panels, each containing:
    - The description text and rebuild button at the top
    - The recipe rows list below
- No logic changes -- just a layout restructure
