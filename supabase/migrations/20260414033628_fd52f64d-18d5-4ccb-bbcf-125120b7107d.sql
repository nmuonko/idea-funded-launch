UPDATE storage.objects
SET metadata = jsonb_set(
  COALESCE(metadata::jsonb, '{}'::jsonb),
  '{mimetype}',
  '"text/html; charset=utf-8"'
)
WHERE bucket_id = 'product-images'
  AND name LIKE 'share-previews/%.html';
