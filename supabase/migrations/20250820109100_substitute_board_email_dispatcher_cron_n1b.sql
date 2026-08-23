-- =============================================================================
-- EduFlow — Substitute Board email dispatcher cron (N1B)
-- =============================================================================
-- Production scheduler for substitute-board-email-dispatcher.
--
-- Architecture (same as printing workers / meeting-reminder-dispatcher):
--   pg_cron → net.http_post → Edge Function substitute-board-email-dispatcher
--   → requireServiceRoleJwt (role=service_role) → outbox claim/send
--
-- Cadence: once per minute (* * * * *) so new publication email processing
-- normally begins within ~1 minute.
--
-- Credentials: Vault secret names only (never hardcoded):
--   PROJECT_PUBLISHABLE_KEY  → apikey header
--   CRON_SERVICE_ROLE_KEY    → Authorization: Bearer <service_role JWT>
--
-- Overlapping cron ticks are safe: N1A job/delivery claim uses
-- FOR UPDATE SKIP LOCKED + 5-minute leases. No application mutex.
--
-- Cron/HTTP failure leaves substitute_board_posts and queued outbox rows intact.
--
-- Depends on: 20250820109000_substitute_board_email_outbox_n1.sql (domain/outbox).
-- DO NOT apply until architecture review / production apply runbook.
-- =============================================================================

-- Fail closed if pg_cron is unavailable.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname IN ('substitute-board-email-dispatcher');
EXCEPTION
  WHEN undefined_table THEN
    RAISE EXCEPTION
      'pg_cron is required for substitute-board-email-dispatcher schedule (N1B)';
END $$;

-- Fail closed if Vault secrets required by the established cron pattern are missing.
DO $$
DECLARE
  v_apikey TEXT;
  v_service_role TEXT;
BEGIN
  SELECT decrypted_secret
  INTO v_apikey
  FROM vault.decrypted_secrets
  WHERE name = 'PROJECT_PUBLISHABLE_KEY'
  LIMIT 1;

  SELECT decrypted_secret
  INTO v_service_role
  FROM vault.decrypted_secrets
  WHERE name = 'CRON_SERVICE_ROLE_KEY'
  LIMIT 1;

  IF v_apikey IS NULL OR length(btrim(v_apikey)) = 0 THEN
    RAISE EXCEPTION
      'Vault secret PROJECT_PUBLISHABLE_KEY is required for substitute-board-email-dispatcher cron (N1B)';
  END IF;

  IF v_service_role IS NULL OR length(btrim(v_service_role)) = 0 THEN
    RAISE EXCEPTION
      'Vault secret CRON_SERVICE_ROLE_KEY is required for substitute-board-email-dispatcher cron (N1B)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE EXCEPTION
      'vault.decrypted_secrets is required for substitute-board-email-dispatcher cron (N1B)';
  WHEN undefined_column THEN
    RAISE EXCEPTION
      'vault.decrypted_secrets.decrypted_secret is required for substitute-board-email-dispatcher cron (N1B)';
END $$;

-- Fail closed if pg_net / net.http_post is unavailable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net'
      AND p.proname = 'http_post'
  ) THEN
    RAISE EXCEPTION
      'pg_net net.http_post is required for substitute-board-email-dispatcher cron (N1B)';
  END IF;
END $$;

-- Every minute: publication email processing begins within ~1 minute.
-- Project URL matches established eduflow / kkafmsvntwqweudallty cron migrations.
-- Secrets are looked up from Vault at execution time — never embedded as literals.
SELECT cron.schedule(
  'substitute-board-email-dispatcher',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://kkafmsvntwqweudallty.supabase.co/functions/v1/substitute-board-email-dispatcher',
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
WHERE jobname = 'substitute-board-email-dispatcher'
ORDER BY jobname;
