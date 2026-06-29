-- Replace hardcoded cron secret literal in any scheduled pg_cron job command
-- with a lookup against vault.decrypted_secrets so the secret can be rotated
-- without code changes.
DO $$
DECLARE
  j RECORD;
  new_cmd TEXT;
BEGIN
  FOR j IN
    SELECT jobid, command
    FROM cron.job
    WHERE command LIKE '%afrishop-internal-cron-2026%'
  LOOP
    new_cmd := replace(
      j.command,
      '''afrishop-internal-cron-2026''',
      '''' || coalesce(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
        ''
      ) || ''''
    );
    PERFORM cron.alter_job(job_id := j.jobid, command := new_cmd);
  END LOOP;
END $$;