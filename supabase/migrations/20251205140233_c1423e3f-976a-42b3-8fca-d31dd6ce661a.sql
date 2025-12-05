-- Add language column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS language text DEFAULT 'fr';

-- Add comment explaining the column
COMMENT ON COLUMN public.profiles.language IS 'User preferred language: fr, en, sw, ln';