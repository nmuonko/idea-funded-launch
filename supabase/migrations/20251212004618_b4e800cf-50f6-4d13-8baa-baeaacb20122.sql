-- VEHICLE QUOTE FIX: Prevent duplicates and ensure cart values match admin input

-- 1. First, clean up any existing duplicates (keep the most recent one)
WITH ranked_quotes AS (
  SELECT 
    id,
    order_item_id,
    ROW_NUMBER() OVER (
      PARTITION BY order_item_id 
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM quote_requests
)
DELETE FROM quote_requests
WHERE id IN (SELECT id FROM ranked_quotes WHERE rn > 1);

-- 2. Add unique constraint on order_item_id to prevent future duplicates
-- Using a unique index to enforce one quote per order_item
ALTER TABLE quote_requests 
DROP CONSTRAINT IF EXISTS uq_quote_requests_order_item_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_requests_order_item_id 
ON quote_requests(order_item_id);

-- 3. Add comment for documentation
COMMENT ON INDEX uq_quote_requests_order_item_id IS 'Ensures only one quote request exists per order item - prevents duplicate key errors in frontend';