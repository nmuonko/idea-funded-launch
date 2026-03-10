UPDATE environments
SET catalog_mode = 'native',
    api_base_url = 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1',
    updated_at = now()
WHERE name = 'production';