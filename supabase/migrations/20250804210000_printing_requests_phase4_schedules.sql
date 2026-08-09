-- Phase 4 printing workers — schedule via approved pg_cron + pg_net pattern
-- (same as meeting-meet-provisioner: vault PROJECT_PUBLISHABLE_KEY + CRON_SERVICE_ROLE_KEY).
-- Idempotent: unschedule-by-name then schedule.

DO $$
BEGIN
  -- Remove prior jobs with these names if present (idempotent re-apply).
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname IN (
    'printing-overdue-dispatcher',
    'printing-retention-cleanup'
  );
EXCEPTION
  WHEN undefined_table THEN
    RAISE EXCEPTION 'pg_cron is required for printing worker schedules';
END $$;

-- Overdue notifications: every 15 minutes, batch_size 50
SELECT cron.schedule(
  'printing-overdue-dispatcher',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kkafmsvntwqweudallty.supabase.co/functions/v1/printing-overdue-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'PROJECT_PUBLISHABLE_KEY'
        LIMIT 1
      ),
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'CRON_SERVICE_ROLE_KEY'
        LIMIT 1
      )
    ),
    body := '{"batch_size": 50}'::jsonb
  ) AS request_id;
  $cron$
);

-- Retention cleanup: daily 02:15 UTC, batch_size 50
SELECT cron.schedule(
  'printing-retention-cleanup',
  '15 2 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kkafmsvntwqweudallty.supabase.co/functions/v1/printing-retention-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'PROJECT_PUBLISHABLE_KEY'
        LIMIT 1
      ),
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'CRON_SERVICE_ROLE_KEY'
        LIMIT 1
      )
    ),
    body := '{"batch_size": 50}'::jsonb
  ) AS request_id;
  $cron$
);

SELECT jobid, jobname, schedule
FROM cron.job
WHERE jobname IN ('printing-overdue-dispatcher', 'printing-retention-cleanup')
ORDER BY jobname;
