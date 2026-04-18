ALTER TABLE public.telegram_import_drafts
  ADD COLUMN IF NOT EXISTS suggested_measurements text,
  ADD COLUMN IF NOT EXISTS suggested_brand text,
  ADD COLUMN IF NOT EXISTS detected_category text;