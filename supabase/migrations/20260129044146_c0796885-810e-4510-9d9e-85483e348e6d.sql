-- Add new columns for vehicle/parts distinction
-- listing_type: 'vehicle' | 'part' | null (for other categories)
-- vehicles_subkey: cars_trucks, motorcycles, powersports, boats, rvs_campers, trailers_other, classic_cars
-- parts_subkey: all_parts, car_truck_parts, wheels_tires, moto_scooter_parts, atv_utv_parts, tools_supplies

ALTER TABLE public.catalog_items 
ADD COLUMN IF NOT EXISTS listing_type text;

ALTER TABLE public.catalog_items 
ADD COLUMN IF NOT EXISTS vehicles_subkey text;

ALTER TABLE public.catalog_items 
ADD COLUMN IF NOT EXISTS parts_subkey text;

-- Add indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_catalog_items_listing_type 
ON public.catalog_items (listing_type) 
WHERE listing_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_items_vehicles_subkey 
ON public.catalog_items (vehicles_subkey) 
WHERE vehicles_subkey IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_items_parts_subkey 
ON public.catalog_items (parts_subkey) 
WHERE parts_subkey IS NOT NULL;

-- Add composite index for vehicles queries
CREATE INDEX IF NOT EXISTS idx_catalog_items_vehicles_composite 
ON public.catalog_items (unified_category, listing_type, vehicles_subkey) 
WHERE unified_category = 'vehicles';

-- Add composite index for parts queries
CREATE INDEX IF NOT EXISTS idx_catalog_items_parts_composite 
ON public.catalog_items (unified_category, listing_type, parts_subkey) 
WHERE unified_category = 'parts_accessories';

-- Update existing motors items to be vehicles (will be backfilled via admin function)
COMMENT ON COLUMN public.catalog_items.listing_type IS 'Distinguishes between vehicle and part listings';
COMMENT ON COLUMN public.catalog_items.vehicles_subkey IS 'Subcategory for vehicles: cars_trucks, motorcycles, powersports, boats, rvs_campers, trailers_other, classic_cars';
COMMENT ON COLUMN public.catalog_items.parts_subkey IS 'Subcategory for parts: all_parts, car_truck_parts, wheels_tires, moto_scooter_parts, atv_utv_parts, tools_supplies';