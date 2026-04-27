WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY provider,
                        COALESCE(NULLIF(title, ''), '__notitle__'),
                        COALESCE(image_url, '__noimg__')
           ORDER BY updated_at DESC NULLS LAST, id
         ) AS rn
  FROM catalog_items
  WHERE provider IN ('shopify_china', 'shein')
)
DELETE FROM catalog_items
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);