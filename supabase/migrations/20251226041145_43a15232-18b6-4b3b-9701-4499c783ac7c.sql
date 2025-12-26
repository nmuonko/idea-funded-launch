-- Migration 1: Enable pgcrypto extension (pg_cron and pg_net already exist)
-- pgcrypto is needed for gen_random_uuid() and cryptographic functions

-- Enable pgcrypto if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Verify pg_cron and pg_net are available (they should already be enabled)
-- These are required for scheduled jobs
-- DO NOT enable them here as they require superuser privileges
-- They should already be available in the project