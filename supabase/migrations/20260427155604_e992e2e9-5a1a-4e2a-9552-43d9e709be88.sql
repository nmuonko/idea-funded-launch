UPDATE public.orders o
SET contains_vehicle = false
WHERE contains_vehicle = true
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = o.id AND oi.is_vehicle = true
  );