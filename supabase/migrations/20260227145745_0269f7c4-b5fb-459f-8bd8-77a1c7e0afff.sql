-- Allow storefront visitors to read active catalog items directly from the database
-- (needed for provider-filtered flat store pages on web)
DROP POLICY IF EXISTS "Public can read active catalog items" ON public.catalog_items;

CREATE POLICY "Public can read active catalog items"
ON public.catalog_items
FOR SELECT
TO anon, authenticated
USING (
  is_active = true
  AND COALESCE(is_disallowed, false) = false
);