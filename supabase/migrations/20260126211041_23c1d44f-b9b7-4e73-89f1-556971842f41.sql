-- Change shipping_percent and service_fee_percent columns to allow whole number percentages (10 = 10%)
ALTER TABLE settings 
  ALTER COLUMN shipping_percent TYPE numeric(6,2),
  ALTER COLUMN service_fee_percent TYPE numeric(6,2);

-- Update the shipping_percent to the correct value (10 = 10%)
UPDATE settings SET shipping_percent = 10 WHERE id = '94cd84a0-bfcb-45ea-95d2-c167181b6a2c';