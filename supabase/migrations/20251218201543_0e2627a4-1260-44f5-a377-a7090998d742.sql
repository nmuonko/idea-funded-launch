-- Add MERCARI to store_type enum (keep TEMU for historical data compatibility)
ALTER TYPE store_type ADD VALUE IF NOT EXISTS 'MERCARI';