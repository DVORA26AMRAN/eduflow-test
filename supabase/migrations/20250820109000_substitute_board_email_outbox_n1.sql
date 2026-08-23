-- =============================================================================
-- EduFlow — Substitute Board email notifications N1 / N1A (durable outbox)
-- =============================================================================
-- Product:
--   Successful INSERT into substitute_board_posts = published.
--   Both post types enqueue ONE publication email job.
--   Recipients = all active Teachers in the same institution (publisher included).
--   External email is NEVER sent in this migration (enqueue only).
--
-- Architecture:
--   AFTER INSERT trigger → job + delivery snapshot rows.
--   Async Edge worker (service_role) sends via Resend.
--   Publication must NOT roll back if email fails.
--
-- N1A lease recovery:
--   Jobs and deliveries use bounded leases (SUBSTITUTE_BOARD_EMAIL_LEASE_INTERVAL
--   = 5 minutes). Stale processing is reclaimable. Delivery claim is atomic
--   (FOR UPDATE SKIP LOCKED). At-least-once delivery + deterministic Resend
--   Idempotency-Key mpex/substitute-board/v1/{post_id}/{recipient_user_id}.
--
-- DO NOT apply until architecture review. Not deployed in this phase.

-- -----------------------------------------------------------------------------
-- Jobs
-- -----------------------------------------------------------------------------

CREATE TABLE public.substitute_board_email_jobs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id                UUID NOT NULL REFERENCES public.substitute_board_posts (id) ON DELETE CASCADE,
    institution_id         UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    event_type             TEXT NOT NULL DEFAULT 'substitute_board_post_published',
    status                 TEXT NOT NULL DEFAULT 'queued',
    attempt_count          INTEGER NOT NULL DEFAULT 0,
    last_error             TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at           TIMESTAMPTZ,
    processing_started_at  TIMESTAMPTZ,
    lease_expires_at       TIMESTAMPTZ,
    CONSTRAINT substitute_board_email_jobs_event_type_valid CHECK (
        event_type = 'substitute_board_post_published'
    ),
    CONSTRAINT substitute_board_email_jobs_status_valid CHECK (
        status IN ('queued', 'processing', 'completed', 'failed')
    ),
    CONSTRAINT substitute_board_email_jobs_attempt_count_nonneg CHECK (attempt_count >= 0),
    CONSTRAINT substitute_board_email_jobs_post_event_unique UNIQUE (post_id, event_type)
);

COMMENT ON TABLE public.substitute_board_email_jobs IS
    'N1/N1A durable outbox: one substitute_board_post_published job per new post INSERT. Lease fields prevent permanent stuck processing.';

COMMENT ON COLUMN public.substitute_board_email_jobs.attempt_count IS
    'Number of times this job was claimed by a worker (claim counter, not delivery sends).';

COMMENT ON COLUMN public.substitute_board_email_jobs.processing_started_at IS
    'Set when a worker acquires a live lease; cleared when leaving processing.';

COMMENT ON COLUMN public.substitute_board_email_jobs.lease_expires_at IS
    'Live lease deadline. Processing rows with lease_expires_at < now() are reclaimable.';

CREATE INDEX substitute_board_email_jobs_status_created_idx
    ON public.substitute_board_email_jobs (status, created_at);

CREATE INDEX substitute_board_email_jobs_lease_idx
    ON public.substitute_board_email_jobs (status, lease_expires_at);

-- -----------------------------------------------------------------------------
-- Deliveries (recipient snapshot at enqueue)
-- -----------------------------------------------------------------------------

CREATE TABLE public.substitute_board_email_deliveries (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                 UUID NOT NULL REFERENCES public.substitute_board_email_jobs (id) ON DELETE CASCADE,
    post_id                UUID NOT NULL REFERENCES public.substitute_board_posts (id) ON DELETE CASCADE,
    institution_id         UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    recipient_user_id      UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    recipient_email        TEXT NOT NULL,
    recipient_full_name    TEXT,
    status                 TEXT NOT NULL DEFAULT 'queued',
    attempt_count          INTEGER NOT NULL DEFAULT 0,
    provider_message_id    TEXT,
    last_error             TEXT,
    sent_at                TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_started_at  TIMESTAMPTZ,
    lease_expires_at       TIMESTAMPTZ,
    CONSTRAINT substitute_board_email_deliveries_status_valid CHECK (
        status IN ('queued', 'processing', 'sent', 'failed', 'skipped')
    ),
    CONSTRAINT substitute_board_email_deliveries_attempt_count_nonneg CHECK (attempt_count >= 0),
    CONSTRAINT substitute_board_email_deliveries_email_nonempty CHECK (
        length(btrim(recipient_email)) > 0
    )
);

COMMENT ON TABLE public.substitute_board_email_deliveries IS
    'N1/N1A per-recipient email ledger. recipient_email/full_name snapshotted at enqueue; profile mutations later do not rewrite queued rows. Active teachers with NULL/blank email are omitted (deterministic exclusion). Delivery claim is atomic with a 5-minute lease.';

COMMENT ON COLUMN public.substitute_board_email_deliveries.attempt_count IS
    'Number of times this delivery was atomically claimed for a send attempt. Incremented once per claim only.';

COMMENT ON COLUMN public.substitute_board_email_deliveries.processing_started_at IS
    'Set on atomic delivery claim; cleared when leaving processing (sent/failed/skipped).';

COMMENT ON COLUMN public.substitute_board_email_deliveries.lease_expires_at IS
    'Live delivery lease. Expired processing rows are reclaimable; valid leases are never reclaimed.';

CREATE UNIQUE INDEX substitute_board_email_deliveries_job_recipient_uidx
    ON public.substitute_board_email_deliveries (job_id, recipient_user_id);

CREATE UNIQUE INDEX substitute_board_email_deliveries_post_recipient_uidx
    ON public.substitute_board_email_deliveries (post_id, recipient_user_id);

CREATE INDEX substitute_board_email_deliveries_status_idx
    ON public.substitute_board_email_deliveries (status, created_at);

CREATE INDEX substitute_board_email_deliveries_lease_idx
    ON public.substitute_board_email_deliveries (job_id, status, lease_expires_at);

DROP TRIGGER IF EXISTS substitute_board_email_deliveries_set_updated_at
    ON public.substitute_board_email_deliveries;
CREATE TRIGGER substitute_board_email_deliveries_set_updated_at
    BEFORE UPDATE ON public.substitute_board_email_deliveries
    FOR EACH ROW
    EXECUTE PROCEDURE public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — fail closed (no browser access)
-- -----------------------------------------------------------------------------

ALTER TABLE public.substitute_board_email_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.substitute_board_email_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.substitute_board_email_jobs FROM PUBLIC;
REVOKE ALL ON TABLE public.substitute_board_email_jobs FROM anon;
REVOKE ALL ON TABLE public.substitute_board_email_jobs FROM authenticated;

REVOKE ALL ON TABLE public.substitute_board_email_deliveries FROM PUBLIC;
REVOKE ALL ON TABLE public.substitute_board_email_deliveries FROM anon;
REVOKE ALL ON TABLE public.substitute_board_email_deliveries FROM authenticated;

-- No policies for anon/authenticated → deny-by-default.
-- service_role bypasses RLS for the Edge worker only.

-- -----------------------------------------------------------------------------
-- Enqueue on NEW INSERT only
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_substitute_board_post_published_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job_id UUID;
    v_inserted INTEGER := 0;
BEGIN
    -- One job per post (unique index); ON CONFLICT no-op if re-fired.
    INSERT INTO public.substitute_board_email_jobs (
        post_id,
        institution_id,
        event_type,
        status
    )
    VALUES (
        NEW.id,
        NEW.institution_id,
        'substitute_board_post_published',
        'queued'
    )
    ON CONFLICT (post_id, event_type)
    DO NOTHING
    RETURNING id INTO v_job_id;

    IF v_job_id IS NULL THEN
        -- Job already existed (idempotent); do not re-snapshot recipients.
        RETURN NEW;
    END IF;

    -- Snapshot eligible Teachers at enqueue time (publisher included if eligible).
    INSERT INTO public.substitute_board_email_deliveries (
        job_id,
        post_id,
        institution_id,
        recipient_user_id,
        recipient_email,
        recipient_full_name,
        status
    )
    SELECT
        v_job_id,
        NEW.id,
        NEW.institution_id,
        u.id,
        btrim(u.email),
        NULLIF(btrim(COALESCE(u.full_name, '')), ''),
        'queued'
    FROM public.users AS u
    WHERE u.institution_id = NEW.institution_id
      AND u.primary_role = 'teacher'::public.user_role
      AND u.status = 'active'
      AND NULLIF(btrim(COALESCE(u.email, '')), '') IS NOT NULL
    ON CONFLICT (job_id, recipient_user_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- No eligible recipients → complete job immediately (still a valid publish).
    IF v_inserted = 0 THEN
        UPDATE public.substitute_board_email_jobs
        SET
            status = 'completed',
            processed_at = NOW(),
            last_error = NULL,
            processing_started_at = NULL,
            lease_expires_at = NULL
        WHERE id = v_job_id;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_substitute_board_post_published_email() IS
    'AFTER INSERT on substitute_board_posts: enqueue one publish email job + recipient snapshots. Never sends email.';

REVOKE ALL ON FUNCTION public.enqueue_substitute_board_post_published_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_substitute_board_post_published_email() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_substitute_board_post_published_email() FROM authenticated;

DROP TRIGGER IF EXISTS substitute_board_posts_enqueue_email_on_insert
    ON public.substitute_board_posts;

CREATE TRIGGER substitute_board_posts_enqueue_email_on_insert
    AFTER INSERT ON public.substitute_board_posts
    FOR EACH ROW
    EXECUTE PROCEDURE public.enqueue_substitute_board_post_published_email();

-- -----------------------------------------------------------------------------
-- N1A constants (documented in function bodies)
-- SUBSTITUTE_BOARD_EMAIL_LEASE_INTERVAL = interval '5 minutes'
-- SUBSTITUTE_BOARD_EMAIL_MAX_DELIVERY_ATTEMPTS = 5
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Worker: claim jobs (service_role only)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_substitute_board_email_jobs(
    p_limit INTEGER DEFAULT 5
)
RETURNS SETOF public.substitute_board_email_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- SUBSTITUTE_BOARD_EMAIL_LEASE_INTERVAL
    v_lease INTERVAL := INTERVAL '5 minutes';
    v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 5), 20));
BEGIN
    -- Stale processing (lease expired or missing lease) is eligible alongside
    -- queued / retryable failed. Valid live leases are never selected.
    RETURN QUERY
    WITH picked AS (
        SELECT j.id
        FROM public.substitute_board_email_jobs AS j
        WHERE j.status IN ('queued', 'failed')
           OR (
                j.status = 'processing'
                AND (
                    j.lease_expires_at IS NULL
                    OR j.lease_expires_at < NOW()
                )
           )
        ORDER BY j.created_at ASC
        FOR UPDATE OF j SKIP LOCKED
        LIMIT v_limit
    )
    UPDATE public.substitute_board_email_jobs AS j
    SET
        status = 'processing',
        processing_started_at = NOW(),
        lease_expires_at = NOW() + v_lease,
        attempt_count = j.attempt_count + 1,
        last_error = NULL
    FROM picked
    WHERE j.id = picked.id
    RETURNING j.*;
END;
$$;

COMMENT ON FUNCTION public.claim_substitute_board_email_jobs(INTEGER) IS
    'N1A worker: claim up to N queued/failed/stale-processing jobs with a 5-minute lease (FOR UPDATE SKIP LOCKED). attempt_count = job claim counter. service_role only.';

REVOKE ALL ON FUNCTION public.claim_substitute_board_email_jobs(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_substitute_board_email_jobs(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_substitute_board_email_jobs(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_substitute_board_email_jobs(INTEGER) TO service_role;

-- -----------------------------------------------------------------------------
-- Worker: atomic delivery claim (service_role only)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_substitute_board_email_deliveries(
    p_job_id UUID,
    p_limit INTEGER DEFAULT 25
)
RETURNS SETOF public.substitute_board_email_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- SUBSTITUTE_BOARD_EMAIL_LEASE_INTERVAL
    v_lease INTERVAL := INTERVAL '5 minutes';
    -- SUBSTITUTE_BOARD_EMAIL_MAX_DELIVERY_ATTEMPTS
    v_max_attempts INTEGER := 5;
    v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION 'invalid_job_id';
    END IF;

    -- Exhausted rows (already claimed 5 times) → terminal skipped without a new claim.
    -- Includes stale processing stuck after the 5th claim crashed before finalize.
    UPDATE public.substitute_board_email_deliveries AS d
    SET
        status = 'skipped',
        last_error = COALESCE(d.last_error, 'max_attempts_exceeded'),
        processing_started_at = NULL,
        lease_expires_at = NULL
    WHERE d.job_id = p_job_id
      AND d.status IN ('failed', 'processing')
      AND d.attempt_count >= v_max_attempts
      AND (
          d.status = 'failed'
          OR d.lease_expires_at IS NULL
          OR d.lease_expires_at < NOW()
      );

    -- Atomic claim: lock + status/lease/attempt_count in one statement.
    -- attempt_count increments exactly once per real send-attempt claim.
    -- Stale lease recovery does not increment until this claim runs.
    RETURN QUERY
    WITH picked AS (
        SELECT d.id
        FROM public.substitute_board_email_deliveries AS d
        WHERE d.job_id = p_job_id
          AND d.attempt_count < v_max_attempts
          AND (
              d.status = 'queued'
              OR d.status = 'failed'
              OR (
                  d.status = 'processing'
                  AND (
                      d.lease_expires_at IS NULL
                      OR d.lease_expires_at < NOW()
                  )
              )
          )
        ORDER BY d.created_at ASC
        FOR UPDATE OF d SKIP LOCKED
        LIMIT v_limit
    )
    UPDATE public.substitute_board_email_deliveries AS d
    SET
        status = 'processing',
        processing_started_at = NOW(),
        lease_expires_at = NOW() + v_lease,
        attempt_count = d.attempt_count + 1,
        last_error = NULL
    FROM picked
    WHERE d.id = picked.id
    RETURNING d.*;
END;
$$;

COMMENT ON FUNCTION public.claim_substitute_board_email_deliveries(UUID, INTEGER) IS
    'N1A worker: atomically claim up to N deliveries for a job (FOR UPDATE SKIP LOCKED, 5-minute lease). Never claims sent/skipped/valid-lease processing. attempt_count += 1 once per claim. service_role only.';

REVOKE ALL ON FUNCTION public.claim_substitute_board_email_deliveries(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_substitute_board_email_deliveries(UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_substitute_board_email_deliveries(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_substitute_board_email_deliveries(UUID, INTEGER) TO service_role;

-- -----------------------------------------------------------------------------
-- Worker: finalize job from delivery state (service_role only)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_substitute_board_email_job(
    p_job_id UUID
)
RETURNS public.substitute_board_email_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job public.substitute_board_email_jobs%ROWTYPE;
    v_max_attempts INTEGER := 5;
    v_queued INTEGER;
    v_failed INTEGER;
    v_processing INTEGER;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION 'invalid_job_id';
    END IF;

    -- Promote exhausted failures/stale processing to skipped before deriving job state.
    UPDATE public.substitute_board_email_deliveries AS d
    SET
        status = 'skipped',
        last_error = COALESCE(d.last_error, 'max_attempts_exceeded'),
        processing_started_at = NULL,
        lease_expires_at = NULL
    WHERE d.job_id = p_job_id
      AND d.status IN ('failed', 'processing')
      AND d.attempt_count >= v_max_attempts
      AND (
          d.status = 'failed'
          OR d.lease_expires_at IS NULL
          OR d.lease_expires_at < NOW()
      );

    SELECT COUNT(*)::INTEGER INTO v_queued
    FROM public.substitute_board_email_deliveries
    WHERE job_id = p_job_id
      AND status = 'queued';

    SELECT COUNT(*)::INTEGER INTO v_failed
    FROM public.substitute_board_email_deliveries
    WHERE job_id = p_job_id
      AND status = 'failed';

    SELECT COUNT(*)::INTEGER INTO v_processing
    FROM public.substitute_board_email_deliveries
    WHERE job_id = p_job_id
      AND status = 'processing';

    IF v_queued = 0 AND v_failed = 0 AND v_processing = 0 THEN
        -- All deliveries sent or skipped (or zero-recipient job already completed).
        UPDATE public.substitute_board_email_jobs
        SET
            status = 'completed',
            last_error = NULL,
            processed_at = NOW(),
            processing_started_at = NULL,
            lease_expires_at = NULL
        WHERE id = p_job_id
        RETURNING * INTO v_job;
    ELSIF v_queued > 0 OR v_processing > 0 THEN
        -- Unfinished work remains (batch limit, live lease, or stale-recoverable).
        -- Leave queued so the next worker can claim; never permanent processing.
        UPDATE public.substitute_board_email_jobs
        SET
            status = 'queued',
            last_error = NULL,
            processed_at = NULL,
            processing_started_at = NULL,
            lease_expires_at = NULL
        WHERE id = p_job_id
        RETURNING * INTO v_job;
    ELSE
        -- Only retryable failed deliveries remain.
        UPDATE public.substitute_board_email_jobs
        SET
            status = 'failed',
            last_error = 'one_or_more_deliveries_failed',
            processed_at = NOW(),
            processing_started_at = NULL,
            lease_expires_at = NULL
        WHERE id = p_job_id
        RETURNING * INTO v_job;
    END IF;

    IF v_job.id IS NULL THEN
        RAISE EXCEPTION 'job_not_found';
    END IF;

    RETURN v_job;
END;
$$;

COMMENT ON FUNCTION public.finalize_substitute_board_email_job(UUID) IS
    'N1A worker: derive job status from deliveries. completed=all sent/skipped; queued=unfinished; failed=retryable failures only. Clears job lease. service_role only.';

REVOKE ALL ON FUNCTION public.finalize_substitute_board_email_job(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_substitute_board_email_job(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_substitute_board_email_job(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_substitute_board_email_job(UUID) TO service_role;
