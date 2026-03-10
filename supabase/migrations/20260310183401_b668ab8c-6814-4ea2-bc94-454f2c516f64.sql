DELETE FROM catalog_cache 
WHERE query ILIKE '%fold%' 
   OR query ILIKE '%telephone%samsung%'
   OR cache_key ILIKE '%fold%'
   OR cache_key ILIKE '%telephone%samsung%galaxy%'