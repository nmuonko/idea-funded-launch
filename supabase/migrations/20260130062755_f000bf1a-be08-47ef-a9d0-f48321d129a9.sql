-- Add new clothing subcategories to catalog_nav_subtabs
-- Keep existing subtabs unchanged, just add new ones

INSERT INTO public.catalog_nav_subtabs (
  key, parent_key, title_en, title_fr, order_index, enabled, is_parts, is_vehicle, provider_mode
) VALUES 
  ('clothing_girls', 'clothing_shoes_accessories', 'Girls', 'Filles', 5, true, false, false, '{"amazon": true, "ebay": true}'::jsonb),
  ('clothing_boys', 'clothing_shoes_accessories', 'Boys', 'Garçons', 6, true, false, false, '{"amazon": true, "ebay": true}'::jsonb),
  ('clothing_baby', 'clothing_shoes_accessories', 'Baby', 'Bébé', 7, true, false, false, '{"amazon": true, "ebay": true}'::jsonb),
  ('clothing_luggage', 'clothing_shoes_accessories', 'Luggage', 'Bagages', 8, true, false, false, '{"amazon": true, "ebay": true}'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  title_en = EXCLUDED.title_en,
  title_fr = EXCLUDED.title_fr,
  order_index = EXCLUDED.order_index,
  enabled = EXCLUDED.enabled;