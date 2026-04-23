UPDATE public.catalog_items
SET is_disallowed = true,
    status_reason = 'ai_generated_placeholder_image'
WHERE id = 'amazon_B0BQCWQBQX'
   OR image_url LIKE '%/I/31woWOz6O0L.%';