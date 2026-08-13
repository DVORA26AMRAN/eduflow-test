-- =============================================================================
-- Release Gate 3.1 — Schedule meeting-reminder-dispatcher
-- =============================================================================
-- Closes production blocker B1: Edge Function is ACTIVE but was never invoked
-- by a production scheduler.
--
-- Architecture (same as printing workers / meeting-meet-provisioner):
--   pg_cron → net.http_post → Edge Function meeting-reminder-dispatcher
--   → requireServiceRoleJwt → RPC meeting_calendar_dispatch_due_reminders
--
-- Credentials: Vault secret names PROJECT_PUBLISHABLE_KEY + CRON_SERVICE_ROLE_KEY
-- (never hardcoded). Do NOT call the dispatch RPC directly from pg_cron.
-- Idempotent: unschedule-by-name then schedule.
-- =============================================================================

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname IN ('meeting-reminder-dispatcher');
EXCEPTION
  WHEN undefined_table THEN
    RAISE EXCEPTION 'pg_cron is required for meeting reminder dispatcher schedule';
END $$;

-- Every 5 minutes: timely enough for 1h reminders; aligns with meet-provisioner cadence.
SELECT cron.schedule(
  'meeting-reminder-dispatcher',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kkafmsvntwqweudallty.supabase.co/functions/v1/meeting-reminder-dispatcher',
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
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'meeting-reminder-dispatcher'
ORDER BY jobname;
