
-- Drop and recreate get_public_config with new return type (no maishapay columns)
DROP FUNCTION IF EXISTS public.get_public_config();

CREATE FUNCTION public.get_public_config()
 RETURNS TABLE(exchange_rate numeric, markup_percent numeric, shipping_base_fee numeric, shipping_percent numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    exchange_rate_usd_to_cdf,
    COALESCE(markup_percent, global_markup_percent, 15),
    shipping_base_fee_usd,
    shipping_percent
  FROM settings 
  LIMIT 1;
$function$;
