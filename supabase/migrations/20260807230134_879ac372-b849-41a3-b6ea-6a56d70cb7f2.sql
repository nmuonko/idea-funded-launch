CREATE OR REPLACE FUNCTION public.publish_priced_telegram_drafts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH p AS (
    SELECT id, telegram_chat_id, telegram_message_id, caption, image_url,
      max(CASE WHEN nullif(btrim(caption),'') IS NOT NULL THEN telegram_message_id END)
        OVER (PARTITION BY telegram_chat_id ORDER BY telegram_message_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS head_id
    FROM telegram_import_drafts
    WHERE status='pending' AND telegram_message_id IS NOT NULL
  ),
  heads AS (
    SELECT telegram_chat_id, telegram_message_id AS head_id, caption,
      COALESCE(
        (regexp_match(caption, '([0-9]{1,5}(?:[.,][0-9]{1,2})?)\s*\.?\s*\$'))[1],
        (regexp_match(caption, '\$\s*([0-9]{1,5}(?:[.,][0-9]{1,2})?)'))[1]
      ) AS price_txt
    FROM telegram_import_drafts
    WHERE status='pending' AND nullif(btrim(caption),'') IS NOT NULL
  ),
  agg AS (
    SELECT telegram_chat_id, head_id,
      (array_agg(image_url ORDER BY telegram_message_id))[1] AS main_image,
      array_agg(image_url ORDER BY telegram_message_id) AS imgs
    FROM p WHERE head_id IS NOT NULL GROUP BY 1,2
  ),
  final AS (
    SELECT a.head_id, a.main_image, a.imgs, h.caption,
      replace(h.price_txt, ',', '.')::numeric AS price
    FROM agg a
    JOIN heads h ON h.telegram_chat_id = a.telegram_chat_id AND h.head_id = a.head_id
    WHERE h.price_txt IS NOT NULL AND replace(h.price_txt, ',', '.')::numeric > 0
  ),
  ins AS (
    INSERT INTO international_products
      (country, title, image_url, product_url, base_price_usd, est_weight_kg, description, images, available_sizes, sort_order, is_active)
    SELECT 'turkey',
      left(COALESCE(nullif(btrim((regexp_split_to_array(f.caption, E'\n'))[1]), ''), 'Turkey Product'), 120),
      f.main_image,
      'https://t.me/dnsp34',
      ceil(f.price)::numeric,
      0.7,
      f.caption,
      to_jsonb(f.imgs),
      COALESCE((SELECT array_agg(DISTINCT m[1]) FROM regexp_matches(f.caption, '\y(3[0-9]|4[0-9]|5[0-9]|60)\y', 'g') AS m), '{}'),
      f.head_id,
      true
    FROM final f
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  WITH p AS (
    SELECT id, telegram_chat_id, telegram_message_id, caption,
      max(CASE WHEN nullif(btrim(caption),'') IS NOT NULL THEN telegram_message_id END)
        OVER (PARTITION BY telegram_chat_id ORDER BY telegram_message_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS head_id
    FROM telegram_import_drafts
    WHERE status='pending' AND telegram_message_id IS NOT NULL
  ),
  heads AS (
    SELECT telegram_chat_id, telegram_message_id AS head_id,
      COALESCE(
        (regexp_match(caption, '([0-9]{1,5}(?:[.,][0-9]{1,2})?)\s*\.?\s*\$'))[1],
        (regexp_match(caption, '\$\s*([0-9]{1,5}(?:[.,][0-9]{1,2})?)'))[1]
      ) AS price_txt
    FROM telegram_import_drafts
    WHERE status='pending' AND nullif(btrim(caption),'') IS NOT NULL
  )
  UPDATE telegram_import_drafts d
  SET status='published', reviewed_at=now(), updated_at=now()
  FROM p JOIN heads h ON h.telegram_chat_id=p.telegram_chat_id AND h.head_id=p.head_id
  WHERE d.id = p.id AND h.price_txt IS NOT NULL;

  RETURN jsonb_build_object('published_products', v_inserted, 'at', now());
END;
$fn$;

REVOKE ALL ON FUNCTION public.publish_priced_telegram_drafts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_priced_telegram_drafts() TO service_role;