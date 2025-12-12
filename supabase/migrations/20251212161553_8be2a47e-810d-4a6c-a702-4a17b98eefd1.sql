-- Add new car store types to the store_type enum
-- This is a non-breaking addition - existing values remain unchanged

ALTER TYPE public.store_type ADD VALUE IF NOT EXISTS 'TESLA_USED';
ALTER TYPE public.store_type ADD VALUE IF NOT EXISTS 'EDMUNDS';