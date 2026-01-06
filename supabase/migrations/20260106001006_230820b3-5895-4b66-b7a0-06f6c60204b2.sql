-- Fix remaining function without search_path: get_store_cache_ttl
-- This is the only one using IMMUTABLE without SET search_path

CREATE OR REPLACE FUNCTION public.get_store_cache_ttl(store_input text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(store_input)
    WHEN 'amazon' THEN 720        -- 12 hours
    WHEN 'ebay' THEN 1440         -- 24 hours
    WHEN 'shein' THEN 1440        -- 24 hours
    WHEN 'walmart' THEN 1440      -- 24 hours
    WHEN 'bestbuy' THEN 1440      -- 24 hours
    WHEN 'target' THEN 1440       -- 24 hours
    WHEN 'temu' THEN 720          -- 12 hours (prices change frequently)
    WHEN 'wayfair' THEN 1440      -- 24 hours
    WHEN 'tesla' THEN 2880        -- 48 hours
    WHEN 'tesla_used' THEN 2880   -- 48 hours
    WHEN 'carvana' THEN 2880      -- 48 hours
    WHEN 'cargurus' THEN 2880     -- 48 hours
    WHEN 'edmunds' THEN 2880      -- 48 hours
    ELSE 720                       -- Default: 12 hours
  END;
$$;