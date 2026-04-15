-- Fix admin_users id mismatch: update to match the actual auth.users id
UPDATE public.admin_users 
SET id = '28aefac3-c011-4b0c-a553-365eea3b494c' 
WHERE email = 'futurescopellc@gmail.com' 
AND id = '7d9a4e80-f039-4115-bf58-e6e13cd53a56';