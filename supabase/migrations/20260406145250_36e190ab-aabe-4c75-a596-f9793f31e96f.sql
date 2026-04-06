
-- Fix items whose primary image_url is a known Amazon shared banner
-- Replace with the first valid gallery image (skip the banner itself)
WITH banner_ids AS (
  SELECT unnest(ARRAY[
    '21dM81tBHEL', '11KzL4MVpQL', '21mfYj1UciL', '11SZyH2kDLL',
    '41AnTRJUFPL', '31HsXnT3BEL', '31pOhhzbBeL', '31A7L6TAn0L',
    '21fmKqMiaNL', 'B1pppR4gVKL', '41WhKIMKHlL', '31WB-8JsNXL',
    '317BjXJ4y3L', '21etarNrlZL', '31BeYpeDggL', '217SmvHdMlL',
    '21JqSSiQ3nL', '31RgPYlBOGL', '31vQAjTt7bL', '31YOGaXh7yL',
    'A16YlCTQRlL', 'A1WybKOVPyL'
  ]) AS banner_id
),
fixable AS (
  SELECT ci.id, ci.images
  FROM catalog_items ci
  WHERE ci.images IS NOT NULL 
    AND jsonb_array_length(ci.images) > 1
    AND EXISTS (
      SELECT 1 FROM banner_ids b WHERE ci.image_url LIKE '%/I/' || b.banner_id || '%'
    )
),
new_images AS (
  SELECT f.id,
    (
      SELECT elem::text
      FROM jsonb_array_elements(f.images) WITH ORDINALITY AS t(elem, ord)
      WHERE NOT EXISTS (
        SELECT 1 FROM banner_ids b WHERE elem::text LIKE '%' || b.banner_id || '%'
      )
      AND elem::text LIKE '%http%'
      ORDER BY ord
      LIMIT 1
    ) AS new_url
  FROM fixable f
)
UPDATE catalog_items ci
SET image_url = trim(both '"' from ni.new_url),
    updated_at = now()
FROM new_images ni
WHERE ci.id = ni.id
  AND ni.new_url IS NOT NULL;
