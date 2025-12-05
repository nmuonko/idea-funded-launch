-- Add UNIQUE constraint on user_id to prevent duplicate profiles
-- This ensures only one profile row can exist per user

-- First, check if constraint already exists and add it if not
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'profiles_user_id_unique'
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_user_id_unique UNIQUE (user_id);
  END IF;
END $$;