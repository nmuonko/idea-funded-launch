
-- Delete ALL existing mobile seeds and re-insert with catalog-matching queries
DELETE FROM home_recipe_seeds 
WHERE recipe_id IN (
  SELECT id FROM home_recipes WHERE target = 'mobile'
);

-- ELECTRONICS (c75aa73f-da63-4276-81a3-eb592d98d63b)
INSERT INTO home_recipe_seeds (recipe_id, query, weight, enabled, sort_order, max_items, required_terms, excluded_terms) VALUES
('c75aa73f-da63-4276-81a3-eb592d98d63b', 'wireless earbuds bluetooth', 2, true, 1, 3, '{}', '{}'),
('c75aa73f-da63-4276-81a3-eb592d98d63b', 'bluetooth speaker portable', 2, true, 2, 3, '{}', '{}'),
('c75aa73f-da63-4276-81a3-eb592d98d63b', 'security camera wireless wifi', 1, true, 3, 3, '{}', '{}'),
('c75aa73f-da63-4276-81a3-eb592d98d63b', 'tablet android', 1, true, 4, 2, '{}', '{}'),
('c75aa73f-da63-4276-81a3-eb592d98d63b', 'smart watch fitness tracker', 2, true, 5, 3, '{}', '{}'),
('c75aa73f-da63-4276-81a3-eb592d98d63b', 'laptop computer', 1, true, 6, 2, '{}', '{}'),
('c75aa73f-da63-4276-81a3-eb592d98d63b', 'noise cancelling headphones', 1, true, 7, 2, '{}', '{}'),
('c75aa73f-da63-4276-81a3-eb592d98d63b', 'portable projector', 1, true, 8, 2, '{}', '{}'),
('c75aa73f-da63-4276-81a3-eb592d98d63b', 'drone camera', 1, true, 9, 2, '{}', '{}'),
('c75aa73f-da63-4276-81a3-eb592d98d63b', 'apple watch', 2, true, 10, 2, '{}', '{"band","strap","case","cover","charger"}');

-- GAMING (b5839d1b-0333-4a78-a4a5-a8e9e1820112)
INSERT INTO home_recipe_seeds (recipe_id, query, weight, enabled, sort_order, max_items, required_terms, excluded_terms) VALUES
('b5839d1b-0333-4a78-a4a5-a8e9e1820112', 'gaming mouse wireless', 2, true, 1, 3, '{}', '{"pad","mat"}'),
('b5839d1b-0333-4a78-a4a5-a8e9e1820112', 'gaming keyboard mechanical', 2, true, 2, 3, '{}', '{}'),
('b5839d1b-0333-4a78-a4a5-a8e9e1820112', 'gaming headset', 2, true, 3, 3, '{}', '{"stand","hanger","hook"}'),
('b5839d1b-0333-4a78-a4a5-a8e9e1820112', 'PS5 controller', 1, true, 4, 2, '{}', '{"skin","sticker","grip","thumb"}'),
('b5839d1b-0333-4a78-a4a5-a8e9e1820112', 'Xbox controller', 1, true, 5, 2, '{}', '{"skin","sticker","grip","thumb"}'),
('b5839d1b-0333-4a78-a4a5-a8e9e1820112', 'gaming monitor', 1, true, 6, 2, '{}', '{}'),
('b5839d1b-0333-4a78-a4a5-a8e9e1820112', 'gaming chair', 1, true, 7, 2, '{}', '{}'),
('b5839d1b-0333-4a78-a4a5-a8e9e1820112', 'RGB mouse pad gaming', 1, true, 8, 2, '{}', '{}'),
('b5839d1b-0333-4a78-a4a5-a8e9e1820112', 'Nintendo Switch', 1, true, 9, 2, '{}', '{"case","screen protector"}'),
('b5839d1b-0333-4a78-a4a5-a8e9e1820112', 'PlayStation game', 1, true, 10, 2, '{}', '{}');

-- CLOTHING (0fb788d1-5b11-4209-97bf-6acaad970949)
INSERT INTO home_recipe_seeds (recipe_id, query, weight, enabled, sort_order, max_items, required_terms, excluded_terms) VALUES
('0fb788d1-5b11-4209-97bf-6acaad970949', 'men t-shirt casual', 2, true, 1, 3, '{}', '{}'),
('0fb788d1-5b11-4209-97bf-6acaad970949', 'women dress casual', 2, true, 2, 3, '{}', '{}'),
('0fb788d1-5b11-4209-97bf-6acaad970949', 'hoodie streetwear', 1, true, 3, 3, '{}', '{}'),
('0fb788d1-5b11-4209-97bf-6acaad970949', 'men shorts cargo', 1, true, 4, 2, '{}', '{}'),
('0fb788d1-5b11-4209-97bf-6acaad970949', 'women bodycon dress', 1, true, 5, 2, '{}', '{}'),
('0fb788d1-5b11-4209-97bf-6acaad970949', 'sneakers shoes', 1, true, 6, 2, '{}', '{}'),
('0fb788d1-5b11-4209-97bf-6acaad970949', 'crossbody bag women', 1, true, 7, 2, '{}', '{}'),
('0fb788d1-5b11-4209-97bf-6acaad970949', 'men polo shirt', 1, true, 8, 2, '{}', '{}'),
('0fb788d1-5b11-4209-97bf-6acaad970949', 'sunglasses fashion', 1, true, 9, 2, '{}', '{}'),
('0fb788d1-5b11-4209-97bf-6acaad970949', 'women summer top', 1, true, 10, 2, '{}', '{}');

-- HOME & GARDEN (52e5a7fb-83b7-4671-b5ea-0c0508875a12)
INSERT INTO home_recipe_seeds (recipe_id, query, weight, enabled, sort_order, max_items, required_terms, excluded_terms) VALUES
('52e5a7fb-83b7-4671-b5ea-0c0508875a12', 'LED strip lights', 2, true, 1, 3, '{}', '{}'),
('52e5a7fb-83b7-4671-b5ea-0c0508875a12', 'air purifier home', 1, true, 2, 3, '{}', '{"filter","replacement"}'),
('52e5a7fb-83b7-4671-b5ea-0c0508875a12', 'kitchen blender', 1, true, 3, 2, '{}', '{}'),
('52e5a7fb-83b7-4671-b5ea-0c0508875a12', 'bedding set comforter', 1, true, 4, 2, '{}', '{}'),
('52e5a7fb-83b7-4671-b5ea-0c0508875a12', 'storage organizer', 1, true, 5, 2, '{}', '{}'),
('52e5a7fb-83b7-4671-b5ea-0c0508875a12', 'robot vacuum cleaner', 1, true, 6, 2, '{}', '{"filter","brush","replacement"}'),
('52e5a7fb-83b7-4671-b5ea-0c0508875a12', 'garden tools set', 1, true, 7, 2, '{}', '{}'),
('52e5a7fb-83b7-4671-b5ea-0c0508875a12', 'camping lantern solar', 1, true, 8, 2, '{}', '{}'),
('52e5a7fb-83b7-4671-b5ea-0c0508875a12', 'pillow decorative', 1, true, 9, 2, '{}', '{}'),
('52e5a7fb-83b7-4671-b5ea-0c0508875a12', 'shower head rainfall', 1, true, 10, 2, '{}', '{}');

-- TOYS (be7fd817-e0db-42b7-96b3-8d83d6f64672)
INSERT INTO home_recipe_seeds (recipe_id, query, weight, enabled, sort_order, max_items, required_terms, excluded_terms) VALUES
('be7fd817-e0db-42b7-96b3-8d83d6f64672', 'toy car kids', 2, true, 1, 3, '{}', '{}'),
('be7fd817-e0db-42b7-96b3-8d83d6f64672', 'building blocks toy', 2, true, 2, 3, '{}', '{}'),
('be7fd817-e0db-42b7-96b3-8d83d6f64672', 'action figure', 1, true, 3, 3, '{}', '{}'),
('be7fd817-e0db-42b7-96b3-8d83d6f64672', 'plush stuffed animal', 1, true, 4, 2, '{}', '{}'),
('be7fd817-e0db-42b7-96b3-8d83d6f64672', 'kids educational toy', 1, true, 5, 2, '{}', '{}'),
('be7fd817-e0db-42b7-96b3-8d83d6f64672', 'board game family', 1, true, 6, 2, '{}', '{}'),
('be7fd817-e0db-42b7-96b3-8d83d6f64672', 'doll playset', 1, true, 7, 2, '{}', '{}'),
('be7fd817-e0db-42b7-96b3-8d83d6f64672', 'puzzle kids', 1, true, 8, 2, '{}', '{}'),
('be7fd817-e0db-42b7-96b3-8d83d6f64672', 'nerf gun blaster', 1, true, 9, 2, '{}', '{}'),
('be7fd817-e0db-42b7-96b3-8d83d6f64672', 'baby toy infant', 1, true, 10, 2, '{}', '{}');

-- SPORTING GOODS (a78528f6-ee7c-4370-9eb6-c1c9808bf22a)
INSERT INTO home_recipe_seeds (recipe_id, query, weight, enabled, sort_order, max_items, required_terms, excluded_terms) VALUES
('a78528f6-ee7c-4370-9eb6-c1c9808bf22a', 'dumbbell weight set', 2, true, 1, 3, '{}', '{}'),
('a78528f6-ee7c-4370-9eb6-c1c9808bf22a', 'resistance bands exercise', 2, true, 2, 3, '{}', '{}'),
('a78528f6-ee7c-4370-9eb6-c1c9808bf22a', 'yoga mat exercise', 1, true, 3, 2, '{}', '{}'),
('a78528f6-ee7c-4370-9eb6-c1c9808bf22a', 'treadmill walking pad', 1, true, 4, 2, '{}', '{}'),
('a78528f6-ee7c-4370-9eb6-c1c9808bf22a', 'soccer ball', 1, true, 5, 2, '{}', '{}'),
('a78528f6-ee7c-4370-9eb6-c1c9808bf22a', 'kettlebell fitness', 1, true, 6, 2, '{}', '{}'),
('a78528f6-ee7c-4370-9eb6-c1c9808bf22a', 'jump rope fitness', 1, true, 7, 2, '{}', '{}'),
('a78528f6-ee7c-4370-9eb6-c1c9808bf22a', 'water bottle insulated', 1, true, 8, 2, '{}', '{}'),
('a78528f6-ee7c-4370-9eb6-c1c9808bf22a', 'boxing gloves training', 1, true, 9, 2, '{}', '{}'),
('a78528f6-ee7c-4370-9eb6-c1c9808bf22a', 'camping tent outdoor', 1, true, 10, 2, '{}', '{}');

-- PARTS & ACCESSORIES (88df7625-bdee-4bf8-b6b4-00ccc7be84f3)
INSERT INTO home_recipe_seeds (recipe_id, query, weight, enabled, sort_order, max_items, required_terms, excluded_terms) VALUES
('88df7625-bdee-4bf8-b6b4-00ccc7be84f3', 'phone case iPhone', 2, true, 1, 3, '{}', '{}'),
('88df7625-bdee-4bf8-b6b4-00ccc7be84f3', 'fast charger USB-C', 2, true, 2, 3, '{}', '{}'),
('88df7625-bdee-4bf8-b6b4-00ccc7be84f3', 'power bank portable', 2, true, 3, 3, '{}', '{}'),
('88df7625-bdee-4bf8-b6b4-00ccc7be84f3', 'screen protector tempered glass', 1, true, 4, 2, '{}', '{}'),
('88df7625-bdee-4bf8-b6b4-00ccc7be84f3', 'laptop sleeve case', 1, true, 5, 2, '{}', '{}'),
('88df7625-bdee-4bf8-b6b4-00ccc7be84f3', 'car phone mount holder', 1, true, 6, 2, '{}', '{}'),
('88df7625-bdee-4bf8-b6b4-00ccc7be84f3', 'USB hub adapter', 1, true, 7, 2, '{}', '{}'),
('88df7625-bdee-4bf8-b6b4-00ccc7be84f3', 'phone case Samsung Galaxy', 1, true, 8, 2, '{}', '{}'),
('88df7625-bdee-4bf8-b6b4-00ccc7be84f3', 'wireless charging pad', 1, true, 9, 2, '{}', '{}'),
('88df7625-bdee-4bf8-b6b4-00ccc7be84f3', 'cable organizer', 1, true, 10, 2, '{}', '{}');

-- HOMEPAGE (7eb031c3-a7a5-4fd7-aa1d-9b24df741f51) - mixed best sellers
INSERT INTO home_recipe_seeds (recipe_id, query, weight, enabled, sort_order, max_items, required_terms, excluded_terms) VALUES
('7eb031c3-a7a5-4fd7-aa1d-9b24df741f51', 'wireless earbuds', 2, true, 1, 3, '{}', '{}'),
('7eb031c3-a7a5-4fd7-aa1d-9b24df741f51', 'phone case protective', 2, true, 2, 2, '{}', '{}'),
('7eb031c3-a7a5-4fd7-aa1d-9b24df741f51', 'bluetooth speaker', 1, true, 3, 2, '{}', '{}'),
('7eb031c3-a7a5-4fd7-aa1d-9b24df741f51', 'power bank charger', 1, true, 4, 2, '{}', '{}'),
('7eb031c3-a7a5-4fd7-aa1d-9b24df741f51', 'LED lights strip', 1, true, 5, 2, '{}', '{}'),
('7eb031c3-a7a5-4fd7-aa1d-9b24df741f51', 'gaming mouse', 1, true, 6, 2, '{}', '{"pad","mat"}'),
('7eb031c3-a7a5-4fd7-aa1d-9b24df741f51', 'smart watch', 1, true, 7, 2, '{}', '{"band","strap","case","cover"}'),
('7eb031c3-a7a5-4fd7-aa1d-9b24df741f51', 'men fashion shirt', 1, true, 8, 2, '{}', '{}');
