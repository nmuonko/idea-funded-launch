-- Fix 1: Replace partial unique index with full unique index on query
DROP INDEX IF EXISTS amazon_ingest_queue_query_unique;
CREATE UNIQUE INDEX IF NOT EXISTS amazon_ingest_queue_query_unique_all
  ON amazon_ingest_queue(query);