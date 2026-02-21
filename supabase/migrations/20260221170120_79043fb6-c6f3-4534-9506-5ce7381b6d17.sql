
-- Add unique constraint on seed_key to enable idempotent inserts
ALTER TABLE public.catalog_seed_queries ADD CONSTRAINT uq_seed_key UNIQUE (seed_key);
