
-- Insert 5 new recipe rows for the new homepage categories
INSERT INTO public.home_recipes (key, target, title_fr, title_en, sort_order, enabled, mode)
VALUES 
  ('beauty_health', 'web', 'Beauté et Santé', 'Beauty & Health', 12, true, 'manual'),
  ('collectibles', 'web', 'Collections', 'Collectibles', 13, true, 'manual'),
  ('audio_music', 'web', 'Audio et Musique', 'Audio & Music', 14, true, 'manual'),
  ('shoes_sneakers', 'web', 'Chaussures et Sneakers', 'Shoes & Sneakers', 15, true, 'manual'),
  ('cameras_photo', 'web', 'Caméras et Photo', 'Cameras & Photo', 16, true, 'manual')
ON CONFLICT (key, target) DO NOTHING;
