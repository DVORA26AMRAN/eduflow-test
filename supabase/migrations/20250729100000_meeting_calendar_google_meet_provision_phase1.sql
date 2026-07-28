-- =============================================================================
-- EduFlow — Meeting Calendar: Google Meet provision Phase 1 (durable outbox)
-- =============================================================================
-- Goals:
--   1) Final confirmation always succeeds independently of Google.
--   2) Online confirmation writes a durable Meet provisioning request in the
--      same transaction (outbox). Frontend fire-and-forget is NOT the trigger.
--   3) If calendar owner has no Google connection: keep CONFIRMED, set
--      meet_provision_status = google_not_connected, do NOT enqueue Google API
--      attempts (outbox status = awaiting_connection).
--   4) Owner may later request one durable pending provision (צור Google Meet /
--      נסה שוב) via RPC — still server-side durable, idempotent.
--   5) Worker/claim RPCs are service_role-only; attach URL remains service_role.
--
-- DO NOT DEPLOY until Phase 1 review. No Edge Functions / OAuth in this file.

-- -----------------------------------------------------------------------------
-- Meeting provision status columns
-- -----------------------------------------------------------------------------

ALTER TABLE public.meetings
    ADD COLUMN IF NOT EXISTS meet_provision_status TEXT,
    ADD COLUMN IF NOT EXISTS meet_provision_error TEXT,
    ADD COLUMN IF NOT EXISTS meet_provisioned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS google_meet_event_id TEXT,
    ADD COLUMN IF NOT EXISTS google_meet_request_id TEXT;

UPDATE public.meetings
SET meet_provision_status = CASE
    WHEN meeting_format IS DISTINCT FROM 'online' THEN 'not_applicable'
    WHEN NULLIF(btrim(COALESCE(meet_url, '')), '') IS NOT NULL THEN 'ready'
    WHEN current_state = 'CONFIRMED' THEN 'google_not_connected'
    ELSE 'not_applicable'
END
WHERE meet_provision_status IS NULL;

ALTER TABLE public.meetings
    ALTER COLUMN meet_provision_status SET DEFAULT 'not_applicable';

ALTER TABLE public.meetings
    ALTER COLUMN meet_provision_status SET NOT NULL;

ALTER TABLE public.meetings
    DROP CONSTRAINT IF EXISTS meetings_meet_provision_status_valid;

ALTER TABLE public.meetings
    ADD CONSTRAINT meetings_meet_provision_status_valid CHECK (
        meet_provision_status IN (
            'not_applicable',
            'google_not_connected',
            'pending',
            'ready',
            'failed'
        )
    );

COMMENT ON COLUMN public.meetings.meet_provision_status IS
    'Google Meet provisioning status. Confirmation never depends on Google.';
COMMENT ON COLUMN public.meetings.meet_provision_error IS
    'Last durable provision failure message (safe for owner UI).';
COMMENT ON COLUMN public.meetings.google_meet_event_id IS
    'Google Calendar event id created for Meet conference (system-managed).';
COMMENT ON COLUMN public.meetings.google_meet_request_id IS
    'Deterministic conferenceData requestId / outbox request_key.';

-- -----------------------------------------------------------------------------
-- Google connection status model (tokens filled by Phase 2 OAuth; encrypted)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_google_connections (
    user_id                     UUID PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
    institution_id              UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    google_account_email        TEXT,
    -- Ciphertext + nonce written only by service_role OAuth (Phase 2). Never expose to clients.
    refresh_token_ciphertext    BYTEA,
    refresh_token_nonce         BYTEA,
    token_scopes                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    connected_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at                  TIMESTAMPTZ,
    CONSTRAINT user_google_connections_ciphertext_paired CHECK (
        (refresh_token_ciphertext IS NULL AND refresh_token_nonce IS NULL)
        OR (refresh_token_ciphertext IS NOT NULL AND refresh_token_nonce IS NOT NULL)
    )
);

COMMENT ON TABLE public.user_google_connections IS
    'Personal Google OAuth connections for Managers/Secretaries. Refresh tokens encrypted; no client SELECT of secrets.';

CREATE INDEX IF NOT EXISTS user_google_connections_institution_idx
    ON public.user_google_connections (institution_id)
    WHERE revoked_at IS NULL;

DROP TRIGGER IF EXISTS user_google_connections_set_updated_at ON public.user_google_connections;
CREATE TRIGGER user_google_connections_set_updated_at
    BEFORE UPDATE ON public.user_google_connections
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();

ALTER TABLE public.user_google_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_google_connections FROM PUBLIC;
REVOKE ALL ON TABLE public.user_google_connections FROM anon;
REVOKE ALL ON TABLE public.user_google_connections FROM authenticated;
-- service_role bypasses RLS; no authenticated policies on purpose (deny-by-default).

-- -----------------------------------------------------------------------------
-- Durable Meet provisioning outbox / request ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.meeting_meet_provision_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id              UUID NOT NULL REFERENCES public.meetings (id) ON DELETE CASCADE,
    institution_id          UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    confirmed_slot_id       UUID NOT NULL REFERENCES public.meeting_slots (id) ON DELETE CASCADE,
    -- Deterministic idempotency key: adoflow-{meeting_id}-{confirmed_slot_id}
    request_key             TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'awaiting_connection',
    trigger_source          TEXT NOT NULL,
    attempt_count           INTEGER NOT NULL DEFAULT 0,
    next_attempt_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error              TEXT,
    google_event_id         TEXT,
    lease_owner             TEXT,
    lease_expires_at        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,

    CONSTRAINT meeting_meet_provision_requests_status_valid CHECK (
        status IN (
            'awaiting_connection',
            'pending',
            'processing',
            'succeeded',
            'failed',
            'cancelled'
        )
    ),
    CONSTRAINT meeting_meet_provision_requests_trigger_valid CHECK (
        trigger_source IN ('confirm', 'owner_request', 'retry')
    ),
    CONSTRAINT meeting_meet_provision_requests_attempt_nonneg CHECK (attempt_count >= 0),
    CONSTRAINT meeting_meet_provision_requests_request_key_unique UNIQUE (request_key)
);

COMMENT ON TABLE public.meeting_meet_provision_requests IS
    'Durable outbox for Google Meet provisioning. Written in confirm TX; processed by backend worker.';

CREATE INDEX IF NOT EXISTS meeting_meet_provision_requests_claim_idx
    ON public.meeting_meet_provision_requests (status, next_attempt_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS meeting_meet_provision_requests_meeting_idx
    ON public.meeting_meet_provision_requests (meeting_id);

DROP TRIGGER IF EXISTS meeting_meet_provision_requests_set_updated_at ON public.meeting_meet_provision_requests;
CREATE TRIGGER meeting_meet_provision_requests_set_updated_at
    BEFORE UPDATE ON public.meeting_meet_provision_requests
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();

ALTER TABLE public.meeting_meet_provision_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meeting_meet_provision_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.meeting_meet_provision_requests FROM anon;
REVOKE ALL ON TABLE public.meeting_meet_provision_requests FROM authenticated;

-- Participants may read non-secret outbox status for their meetings (no tokens).
GRANT SELECT ON TABLE public.meeting_meet_provision_requests TO authenticated;

DROP POLICY IF EXISTS meeting_meet_provision_requests_select_participants
    ON public.meeting_meet_provision_requests;
CREATE POLICY meeting_meet_provision_requests_select_participants
    ON public.meeting_meet_provision_requests
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings AS m
            WHERE m.id = meeting_id
              AND auth.uid() IN (m.requester_id, m.recipient_id, m.calendar_owner_id, m.creator_id)
              AND EXISTS (
                  SELECT 1
                  FROM public.users AS u
                  WHERE u.id = auth.uid()
                    AND u.status = 'active'
                    AND u.institution_id IS NOT DISTINCT FROM m.institution_id
              )
        )
    );

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_require_service_role_jwt()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_jwt_role TEXT;
BEGIN
    -- Do not use current_user: SECURITY DEFINER runs as owner (often postgres).
    v_jwt_role := COALESCE(auth.jwt() ->> 'role', auth.role());
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_require_service_role_jwt() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.meeting_calendar_build_meet_request_key(
    p_meeting_id UUID,
    p_confirmed_slot_id UUID
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT 'adoflow-' || p_meeting_id::TEXT || '-' || p_confirmed_slot_id::TEXT;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_build_meet_request_key(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_build_meet_request_key(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_build_meet_request_key(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.meeting_calendar_owner_has_google_connection(
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_google_connections AS c
        WHERE c.user_id = p_user_id
          AND c.revoked_at IS NULL
          AND c.refresh_token_ciphertext IS NOT NULL
          AND c.refresh_token_nonce IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_owner_has_google_connection(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.meeting_calendar_assert_google_integration_role()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
    v_status TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT primary_role, status
    INTO v_role, v_status
    FROM public.users
    WHERE id = auth.uid();

    IF NOT FOUND
       OR v_status IS DISTINCT FROM 'active'
       OR v_role NOT IN ('institution_manager', 'secretary')
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_assert_google_integration_role() FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Enqueue / sync provision request (same TX as confirm or owner request)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_sync_meet_provision_request(
    p_meeting_id UUID,
    p_institution_id UUID,
    p_calendar_owner_id UUID,
    p_confirmed_slot_id UUID,
    p_meeting_format TEXT,
    p_previous_confirmed_slot_id UUID DEFAULT NULL,
    p_trigger_source TEXT DEFAULT 'confirm'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request_key TEXT;
    v_connected BOOLEAN;
    v_outbox_status TEXT;
    v_meeting_status TEXT;
    v_existing public.meeting_meet_provision_requests%ROWTYPE;
BEGIN
    IF p_trigger_source NOT IN ('confirm', 'owner_request', 'retry') THEN
        RAISE EXCEPTION 'Invalid meet provision trigger source.' USING ERRCODE = 'P0001';
    END IF;

    IF p_meeting_format IS DISTINCT FROM 'online' THEN
        UPDATE public.meetings
        SET
            meet_provision_status = 'not_applicable',
            meet_provision_error = NULL,
            google_meet_request_id = NULL,
            updated_at = NOW()
        WHERE id = p_meeting_id;

        UPDATE public.meeting_meet_provision_requests
        SET
            status = 'cancelled',
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE meeting_id = p_meeting_id
          AND status IN ('awaiting_connection', 'pending', 'processing', 'failed');

        RETURN jsonb_build_object(
            'ok', true,
            'meet_provision_status', 'not_applicable',
            'enqueued', false
        );
    END IF;

    -- New confirmed slot ⇒ new deterministic key; cancel prior open requests.
    IF p_previous_confirmed_slot_id IS NOT NULL
       AND p_previous_confirmed_slot_id IS DISTINCT FROM p_confirmed_slot_id
    THEN
        UPDATE public.meeting_meet_provision_requests
        SET
            status = 'cancelled',
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE meeting_id = p_meeting_id
          AND confirmed_slot_id = p_previous_confirmed_slot_id
          AND status IN ('awaiting_connection', 'pending', 'processing', 'failed');

        UPDATE public.meetings
        SET
            meet_url = NULL,
            google_meet_event_id = NULL,
            meet_provisioned_at = NULL,
            meet_provision_error = NULL,
            updated_at = NOW()
        WHERE id = p_meeting_id;
    END IF;

    v_request_key := public.meeting_calendar_build_meet_request_key(
        p_meeting_id,
        p_confirmed_slot_id
    );
    v_connected := public.meeting_calendar_owner_has_google_connection(p_calendar_owner_id);

    SELECT * INTO v_existing
    FROM public.meeting_meet_provision_requests
    WHERE request_key = v_request_key
    FOR UPDATE;

    IF FOUND AND v_existing.status = 'succeeded' THEN
        UPDATE public.meetings
        SET
            meet_provision_status = 'ready',
            google_meet_request_id = v_request_key,
            meet_provision_error = NULL,
            updated_at = NOW()
        WHERE id = p_meeting_id;

        RETURN jsonb_build_object(
            'ok', true,
            'meet_provision_status', 'ready',
            'request_key', v_request_key,
            'enqueued', false,
            'idempotent', true
        );
    END IF;

    IF v_connected THEN
        v_outbox_status := 'pending';
        v_meeting_status := 'pending';
    ELSE
        -- Durable marker only — worker must never call Google for this status.
        v_outbox_status := 'awaiting_connection';
        v_meeting_status := 'google_not_connected';
    END IF;

    -- Owner explicit create/retry while disconnected: keep confirmed, no Google attempts.
    IF NOT v_connected AND p_trigger_source IN ('owner_request', 'retry') THEN
        v_outbox_status := 'awaiting_connection';
        v_meeting_status := 'google_not_connected';
    END IF;

    INSERT INTO public.meeting_meet_provision_requests (
        meeting_id,
        institution_id,
        confirmed_slot_id,
        request_key,
        status,
        trigger_source,
        attempt_count,
        next_attempt_at,
        last_error,
        lease_owner,
        lease_expires_at,
        completed_at
    ) VALUES (
        p_meeting_id,
        p_institution_id,
        p_confirmed_slot_id,
        v_request_key,
        v_outbox_status,
        p_trigger_source,
        0,
        NOW(),
        NULL,
        NULL,
        NULL,
        NULL
    )
    ON CONFLICT (request_key) DO UPDATE
    SET
        confirmed_slot_id = EXCLUDED.confirmed_slot_id,
        trigger_source = EXCLUDED.trigger_source,
        status = CASE
            WHEN public.meeting_meet_provision_requests.status = 'succeeded' THEN
                public.meeting_meet_provision_requests.status
            WHEN public.meeting_meet_provision_requests.status = 'processing'
                 AND public.meeting_meet_provision_requests.lease_expires_at IS NOT NULL
                 AND public.meeting_meet_provision_requests.lease_expires_at > NOW() THEN
                public.meeting_meet_provision_requests.status
            ELSE EXCLUDED.status
        END,
        next_attempt_at = CASE
            WHEN public.meeting_meet_provision_requests.status = 'succeeded' THEN
                public.meeting_meet_provision_requests.next_attempt_at
            WHEN public.meeting_meet_provision_requests.status = 'processing'
                 AND public.meeting_meet_provision_requests.lease_expires_at IS NOT NULL
                 AND public.meeting_meet_provision_requests.lease_expires_at > NOW() THEN
                public.meeting_meet_provision_requests.next_attempt_at
            ELSE NOW()
        END,
        last_error = CASE
            WHEN EXCLUDED.status = 'pending' THEN NULL
            WHEN EXCLUDED.status = 'awaiting_connection' THEN NULL
            ELSE public.meeting_meet_provision_requests.last_error
        END,
        lease_owner = CASE
            WHEN EXCLUDED.status IN ('pending', 'awaiting_connection')
                 AND NOT (
                     public.meeting_meet_provision_requests.status = 'processing'
                     AND public.meeting_meet_provision_requests.lease_expires_at IS NOT NULL
                     AND public.meeting_meet_provision_requests.lease_expires_at > NOW()
                 )
            THEN NULL
            ELSE public.meeting_meet_provision_requests.lease_owner
        END,
        lease_expires_at = CASE
            WHEN EXCLUDED.status IN ('pending', 'awaiting_connection')
                 AND NOT (
                     public.meeting_meet_provision_requests.status = 'processing'
                     AND public.meeting_meet_provision_requests.lease_expires_at IS NOT NULL
                     AND public.meeting_meet_provision_requests.lease_expires_at > NOW()
                 )
            THEN NULL
            ELSE public.meeting_meet_provision_requests.lease_expires_at
        END,
        completed_at = CASE
            WHEN public.meeting_meet_provision_requests.status = 'succeeded' THEN
                public.meeting_meet_provision_requests.completed_at
            ELSE NULL
        END,
        updated_at = NOW()
    WHERE public.meeting_meet_provision_requests.status IS DISTINCT FROM 'succeeded';

    UPDATE public.meetings
    SET
        meet_provision_status = v_meeting_status,
        google_meet_request_id = v_request_key,
        meet_provision_error = CASE
            WHEN v_meeting_status = 'pending' THEN NULL
            WHEN v_meeting_status = 'google_not_connected' THEN NULL
            ELSE meet_provision_error
        END,
        updated_at = NOW()
    WHERE id = p_meeting_id;

    RETURN jsonb_build_object(
        'ok', true,
        'meet_provision_status', v_meeting_status,
        'request_key', v_request_key,
        'enqueued', (v_outbox_status = 'pending'),
        'google_connected', v_connected
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_sync_meet_provision_request(
    UUID, UUID, UUID, UUID, TEXT, UUID, TEXT
) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Confirm: atomic Adoflow confirm + durable Meet request (never blocked by Google)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_confirm_meeting(p_meeting_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_slot public.meeting_slots%ROWTYPE;
    v_non_owner_id UUID;
    v_previous_confirmed_slot_id UUID;
    v_is_reschedule BOOLEAN;
    v_meet_sync JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    v_is_reschedule := (v_meeting.current_state = 'CONFIRMED' AND v_meeting.rescheduling_active);

    IF v_meeting.current_state <> 'WAITING_FOR_FINAL_CONFIRMATION' AND NOT v_is_reschedule THEN
        RAISE EXCEPTION 'Meeting is not awaiting final confirmation.' USING ERRCODE = 'P0001';
    END IF;

    IF v_is_reschedule AND v_meeting.pending_slot_id IS NULL THEN
        RAISE EXCEPTION 'Meeting is missing a pending selected slot.' USING ERRCODE = 'P0001';
    END IF;

    v_non_owner_id := public.meeting_calendar_non_owner_participant_id(
        v_meeting.requester_id,
        v_meeting.recipient_id,
        v_meeting.calendar_owner_id
    );

    IF auth.uid() IS DISTINCT FROM v_non_owner_id THEN
        RAISE EXCEPTION 'Only the slot selector may confirm the meeting.' USING ERRCODE = '42501';
    END IF;

    IF v_meeting.slot_selected_by_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Caller did not select the active proposed slot.' USING ERRCODE = '42501';
    END IF;

    IF v_meeting.pending_slot_id IS NULL THEN
        RAISE EXCEPTION 'Meeting is missing a pending selected slot.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_slot
    FROM public.meeting_slots
    WHERE id = v_meeting.pending_slot_id
      AND meeting_id = p_meeting_id
      AND proposal_cycle = v_meeting.active_proposal_cycle
      AND slot_status = 'selected'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected slot is not valid for the active proposal cycle.' USING ERRCODE = 'P0001';
    END IF;

    IF public.meeting_calendar_participant_has_confirmed_overlap(
        v_meeting.requester_id, v_slot.starts_at, v_slot.ends_at, p_meeting_id
    ) OR public.meeting_calendar_participant_has_confirmed_overlap(
        v_meeting.recipient_id, v_slot.starts_at, v_slot.ends_at, p_meeting_id
    ) THEN
        RAISE EXCEPTION 'Selected slot conflicts with another confirmed meeting.' USING ERRCODE = 'P0001';
    END IF;

    v_previous_confirmed_slot_id := v_meeting.confirmed_slot_id;

    PERFORM set_config('meeting_calendar.allow_slot_mutation', 'on', true);

    IF v_previous_confirmed_slot_id IS NOT NULL THEN
        UPDATE public.meeting_slots
        SET slot_status = 'superseded'
        WHERE id = v_previous_confirmed_slot_id;
    END IF;

    UPDATE public.meeting_slots
    SET slot_status = 'confirmed'
    WHERE id = v_slot.id;

    PERFORM set_config('meeting_calendar.allow_state_transition', 'on', true);

    UPDATE public.meetings
    SET
        confirmed_slot_id = v_slot.id,
        pending_slot_id = NULL,
        slot_selected_by_user_id = NULL,
        rescheduling_active = FALSE,
        rescheduling_initiated_at = NULL,
        rescheduling_initiated_by_user_id = NULL,
        current_state = 'CONFIRMED'
    WHERE id = p_meeting_id;

    PERFORM public.meeting_calendar_write_audit(
        p_meeting_id,
        v_meeting.institution_id,
        auth.uid(),
        'meeting_confirmed',
        v_meeting.current_state,
        'CONFIRMED',
        v_meeting.active_proposal_cycle,
        v_slot.id,
        jsonb_build_object(
            'previous_confirmed_slot_id', v_previous_confirmed_slot_id,
            'rescheduling_active', v_meeting.rescheduling_active
        )
    );

    IF v_previous_confirmed_slot_id IS NOT NULL THEN
        PERFORM public.meeting_calendar_cancel_pending_reminders_for_slot(
            v_previous_confirmed_slot_id
        );
    END IF;

    PERFORM public.meeting_calendar_schedule_reminders_for_slot(
        p_meeting_id,
        v_slot.id,
        NOW()
    );

    -- Durable Meet outbox in the same transaction. Never raises due to Google.
    v_meet_sync := public.meeting_calendar_sync_meet_provision_request(
        p_meeting_id,
        v_meeting.institution_id,
        v_meeting.calendar_owner_id,
        v_slot.id,
        COALESCE(v_meeting.meeting_format, 'in_person'),
        v_previous_confirmed_slot_id,
        'confirm'
    );

    RETURN jsonb_build_object(
        'ok', true,
        'current_state', 'CONFIRMED',
        'meet_provision_status', v_meet_sync ->> 'meet_provision_status',
        'meet_provision_enqueued', COALESCE((v_meet_sync ->> 'enqueued')::BOOLEAN, false)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_confirm_meeting(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_confirm_meeting(UUID) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_confirm_meeting(UUID) IS
    'Confirms meeting atomically; for online meetings writes durable Meet provision outbox in the same TX. Never blocked by Google connectivity.';

-- -----------------------------------------------------------------------------
-- Owner: צור Google Meet / נסה שוב → one durable pending request (idempotent)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_request_meet_provision(
    p_meeting_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_trigger TEXT;
    v_result JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF auth.uid() IS DISTINCT FROM v_meeting.calendar_owner_id THEN
        RAISE EXCEPTION 'Only the calendar owner may request Google Meet provisioning.' USING ERRCODE = '42501';
    END IF;

    PERFORM public.meeting_calendar_assert_actor_same_institution(v_meeting);

    IF v_meeting.current_state <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Google Meet can only be created for confirmed meetings.' USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.meeting_format <> 'online' THEN
        RAISE EXCEPTION 'Google Meet is only available for online meetings.' USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.confirmed_slot_id IS NULL THEN
        RAISE EXCEPTION 'Meeting is missing a confirmed slot.' USING ERRCODE = 'P0001';
    END IF;

    IF NULLIF(btrim(COALESCE(v_meeting.meet_url, '')), '') IS NOT NULL
       AND v_meeting.meet_provision_status = 'ready'
    THEN
        RETURN jsonb_build_object(
            'ok', true,
            'meet_provision_status', 'ready',
            'idempotent', true,
            'meet_url', v_meeting.meet_url
        );
    END IF;

    v_trigger := CASE
        WHEN v_meeting.meet_provision_status = 'failed' THEN 'retry'
        ELSE 'owner_request'
    END;

    v_result := public.meeting_calendar_sync_meet_provision_request(
        p_meeting_id,
        v_meeting.institution_id,
        v_meeting.calendar_owner_id,
        v_meeting.confirmed_slot_id,
        v_meeting.meeting_format,
        NULL,
        v_trigger
    );

    RETURN jsonb_build_object(
        'ok', true,
        'meet_provision_status', v_result ->> 'meet_provision_status',
        'enqueued', COALESCE((v_result ->> 'enqueued')::BOOLEAN, false),
        'google_connected', COALESCE((v_result ->> 'google_connected')::BOOLEAN, false),
        'request_key', v_result ->> 'request_key',
        'code', CASE
            WHEN (v_result ->> 'meet_provision_status') = 'google_not_connected'
                THEN 'GOOGLE_NOT_CONNECTED'
            ELSE NULL
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_request_meet_provision(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_request_meet_provision(UUID) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_request_meet_provision(UUID) IS
    'Calendar owner creates one durable Meet provision request for an already-confirmed online meeting. Idempotent.';

-- -----------------------------------------------------------------------------
-- Status reads (no secrets)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_get_google_connection_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.user_google_connections%ROWTYPE;
BEGIN
    PERFORM public.meeting_calendar_assert_google_integration_role();

    SELECT * INTO v_row
    FROM public.user_google_connections
    WHERE user_id = auth.uid()
      AND revoked_at IS NULL;

    IF NOT FOUND
       OR v_row.refresh_token_ciphertext IS NULL
       OR v_row.refresh_token_nonce IS NULL
    THEN
        RETURN jsonb_build_object('ok', true, 'connected', false, 'email', NULL);
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'connected', true,
        'email', v_row.google_account_email
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_get_google_connection_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_get_google_connection_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.meeting_calendar_get_meet_provision_status(
    p_meeting_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_req public.meeting_meet_provision_requests%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.meeting_calendar_is_meeting_participant(v_meeting, auth.uid()) THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    PERFORM public.meeting_calendar_assert_actor_same_institution(v_meeting);

    IF v_meeting.google_meet_request_id IS NOT NULL THEN
        SELECT * INTO v_req
        FROM public.meeting_meet_provision_requests
        WHERE request_key = v_meeting.google_meet_request_id;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'meeting_id', v_meeting.id,
        'meeting_format', v_meeting.meeting_format,
        'current_state', v_meeting.current_state,
        'meet_provision_status', v_meeting.meet_provision_status,
        'meet_provision_error', v_meeting.meet_provision_error,
        'meet_url', CASE
            WHEN v_meeting.meeting_format = 'online' THEN v_meeting.meet_url
            ELSE NULL
        END,
        'google_meet_request_id', v_meeting.google_meet_request_id,
        'outbox_status', v_req.status,
        'can_request_meet', (
            auth.uid() = v_meeting.calendar_owner_id
            AND v_meeting.current_state = 'CONFIRMED'
            AND v_meeting.meeting_format = 'online'
            AND (
                v_meeting.meet_provision_status IN ('google_not_connected', 'failed', 'pending')
                OR NULLIF(btrim(COALESCE(v_meeting.meet_url, '')), '') IS NULL
            )
        ),
        'owner_google_connected', public.meeting_calendar_owner_has_google_connection(
            v_meeting.calendar_owner_id
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_get_meet_provision_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_get_meet_provision_status(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Service-role connection upsert / revoke (Phase 2 OAuth will call these)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_upsert_google_connection(
    p_user_id UUID,
    p_institution_id UUID,
    p_google_account_email TEXT,
    p_refresh_token_ciphertext BYTEA,
    p_refresh_token_nonce BYTEA,
    p_token_scopes TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    IF p_refresh_token_ciphertext IS NULL OR p_refresh_token_nonce IS NULL THEN
        RAISE EXCEPTION 'Encrypted refresh token is required.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.user_google_connections (
        user_id,
        institution_id,
        google_account_email,
        refresh_token_ciphertext,
        refresh_token_nonce,
        token_scopes,
        connected_at,
        revoked_at
    ) VALUES (
        p_user_id,
        p_institution_id,
        NULLIF(btrim(COALESCE(p_google_account_email, '')), ''),
        p_refresh_token_ciphertext,
        p_refresh_token_nonce,
        COALESCE(p_token_scopes, ARRAY[]::TEXT[]),
        NOW(),
        NULL
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
        institution_id = EXCLUDED.institution_id,
        google_account_email = EXCLUDED.google_account_email,
        refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
        refresh_token_nonce = EXCLUDED.refresh_token_nonce,
        token_scopes = EXCLUDED.token_scopes,
        connected_at = NOW(),
        revoked_at = NULL,
        updated_at = NOW();

    RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'connected', true);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, BYTEA, BYTEA, TEXT[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, BYTEA, BYTEA, TEXT[]
) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, BYTEA, BYTEA, TEXT[]
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, BYTEA, BYTEA, TEXT[]
) TO service_role;

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_revoke_google_connection(
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    UPDATE public.user_google_connections
    SET
        refresh_token_ciphertext = NULL,
        refresh_token_nonce = NULL,
        revoked_at = NOW(),
        updated_at = NOW()
    WHERE user_id = p_user_id
      AND revoked_at IS NULL;

    RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'connected', false);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_revoke_google_connection(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_revoke_google_connection(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_revoke_google_connection(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_revoke_google_connection(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- Worker claim / complete / fail (Phase 3 provisioner; no Google API here)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_claim_meet_provision_batch(
    p_limit INTEGER DEFAULT 10,
    p_lease_seconds INTEGER DEFAULT 60,
    p_worker_id TEXT DEFAULT 'meet-provisioner'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INTEGER;
    v_lease INTERVAL;
    v_rows JSONB := '[]'::JSONB;
    v_row public.meeting_meet_provision_requests%ROWTYPE;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
    v_lease := make_interval(secs => GREATEST(15, LEAST(COALESCE(p_lease_seconds, 60), 300)));

    -- Recover expired leases so crashed workers cannot strand work.
    UPDATE public.meeting_meet_provision_requests
    SET
        status = 'pending',
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
    WHERE status = 'processing'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < NOW();

    FOR v_row IN
        SELECT *
        FROM public.meeting_meet_provision_requests
        WHERE status = 'pending'
          AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT v_limit
    LOOP
        UPDATE public.meeting_meet_provision_requests
        SET
            status = 'processing',
            lease_owner = COALESCE(NULLIF(btrim(p_worker_id), ''), 'meet-provisioner'),
            lease_expires_at = NOW() + v_lease,
            attempt_count = attempt_count + 1,
            updated_at = NOW()
        WHERE id = v_row.id
        RETURNING * INTO v_row;

        UPDATE public.meetings
        SET
            meet_provision_status = 'pending',
            updated_at = NOW()
        WHERE id = v_row.meeting_id
          AND meet_provision_status IS DISTINCT FROM 'ready';

        v_rows := v_rows || jsonb_build_array(
            jsonb_build_object(
                'id', v_row.id,
                'meeting_id', v_row.meeting_id,
                'institution_id', v_row.institution_id,
                'confirmed_slot_id', v_row.confirmed_slot_id,
                'request_key', v_row.request_key,
                'attempt_count', v_row.attempt_count,
                'lease_expires_at', v_row.lease_expires_at
            )
        );
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'claimed', jsonb_array_length(v_rows), 'requests', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_claim_meet_provision_batch(INTEGER, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_claim_meet_provision_batch(INTEGER, INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_claim_meet_provision_batch(INTEGER, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_claim_meet_provision_batch(INTEGER, INTEGER, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.meeting_calendar_complete_meet_provision(
    p_request_id UUID,
    p_meet_url TEXT,
    p_google_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req public.meeting_meet_provision_requests%ROWTYPE;
    v_attach JSONB;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    SELECT * INTO v_req
    FROM public.meeting_meet_provision_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meet provision request not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.status = 'succeeded' THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', 'succeeded');
    END IF;

    IF v_req.status NOT IN ('processing', 'pending', 'failed') THEN
        RAISE EXCEPTION 'Meet provision request is not completable.' USING ERRCODE = 'P0001';
    END IF;

    v_attach := public.meeting_calendar_attach_system_meet_url(v_req.meeting_id, p_meet_url);

    UPDATE public.meeting_meet_provision_requests
    SET
        status = 'succeeded',
        google_event_id = NULLIF(btrim(COALESCE(p_google_event_id, '')), ''),
        last_error = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_request_id;

    UPDATE public.meetings
    SET
        meet_provision_status = 'ready',
        meet_provision_error = NULL,
        meet_provisioned_at = NOW(),
        google_meet_event_id = NULLIF(btrim(COALESCE(p_google_event_id, '')), ''),
        google_meet_request_id = v_req.request_key,
        updated_at = NOW()
    WHERE id = v_req.meeting_id;

    RETURN jsonb_build_object(
        'ok', true,
        'status', 'succeeded',
        'attach', v_attach,
        'request_key', v_req.request_key
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_complete_meet_provision(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_complete_meet_provision(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_complete_meet_provision(UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_complete_meet_provision(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.meeting_calendar_fail_meet_provision(
    p_request_id UUID,
    p_error TEXT,
    p_retry_delay_seconds INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req public.meeting_meet_provision_requests%ROWTYPE;
    v_delay INTEGER;
    v_next_status TEXT;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    SELECT * INTO v_req
    FROM public.meeting_meet_provision_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meet provision request not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.status = 'succeeded' THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', 'succeeded');
    END IF;

    v_delay := GREATEST(0, COALESCE(p_retry_delay_seconds, 0));
    -- Automatic worker requeue only when explicitly delayed; otherwise durable failed
    -- until owner clicks נסה שוב (request_meet_provision).
    v_next_status := CASE WHEN v_delay > 0 THEN 'pending' ELSE 'failed' END;

    UPDATE public.meeting_meet_provision_requests
    SET
        status = v_next_status,
        last_error = NULLIF(btrim(COALESCE(p_error, '')), ''),
        next_attempt_at = NOW() + make_interval(secs => v_delay),
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
    WHERE id = p_request_id;

    UPDATE public.meetings
    SET
        meet_provision_status = 'failed',
        meet_provision_error = NULLIF(btrim(COALESCE(p_error, '')), ''),
        updated_at = NOW()
    WHERE id = v_req.meeting_id
      AND meet_provision_status IS DISTINCT FROM 'ready';

    RETURN jsonb_build_object(
        'ok', true,
        'status', v_next_status,
        'meet_provision_status', 'failed'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_fail_meet_provision(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_fail_meet_provision(UUID, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_fail_meet_provision(UUID, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_fail_meet_provision(UUID, TEXT, INTEGER) TO service_role;

-- -----------------------------------------------------------------------------
-- Live context: expose provision status (UI Phase 4 will consume)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_get_live_context(
    p_meeting_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_slot public.meeting_slots%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
    v_primary_available BOOLEAN := FALSE;
    v_delay_available BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.meeting_calendar_is_meeting_participant(v_meeting, auth.uid()) THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    PERFORM public.meeting_calendar_assert_actor_same_institution(v_meeting);

    IF v_meeting.confirmed_slot_id IS NOT NULL THEN
        SELECT * INTO v_slot
        FROM public.meeting_slots
        WHERE id = v_meeting.confirmed_slot_id
          AND meeting_id = p_meeting_id;
    END IF;

    IF v_meeting.current_state = 'CONFIRMED'
       AND v_slot.id IS NOT NULL
       AND v_slot.slot_status = 'confirmed'
    THEN
        v_primary_available := (v_now >= v_slot.starts_at - INTERVAL '15 minutes')
            AND (v_now < v_slot.ends_at);
        v_delay_available := (v_now >= v_slot.starts_at - INTERVAL '30 minutes')
            AND (v_now < v_slot.ends_at);
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'meeting_id', v_meeting.id,
        'current_state', v_meeting.current_state,
        'meeting_format', v_meeting.meeting_format,
        'meet_url', CASE
            WHEN v_meeting.meeting_format = 'online' THEN v_meeting.meet_url
            ELSE NULL
        END,
        'meet_provision_status', v_meeting.meet_provision_status,
        'meet_provision_error', v_meeting.meet_provision_error,
        'phone_number', CASE
            WHEN v_meeting.meeting_format = 'phone' THEN v_meeting.phone_number
            ELSE NULL
        END,
        'starts_at', v_slot.starts_at,
        'ends_at', v_slot.ends_at,
        'delay_minutes', v_meeting.delay_minutes,
        'delay_reported_by_user_id', v_meeting.delay_reported_by_user_id,
        'delay_reported_at', v_meeting.delay_reported_at,
        'primary_action_available', v_primary_available,
        'delay_action_available', v_delay_available,
        'can_set_connection_details', (auth.uid() = v_meeting.calendar_owner_id
            AND v_meeting.current_state <> 'CANCELLED'),
        'can_request_meet_provision', (
            auth.uid() = v_meeting.calendar_owner_id
            AND v_meeting.current_state = 'CONFIRMED'
            AND v_meeting.meeting_format = 'online'
            AND NULLIF(btrim(COALESCE(v_meeting.meet_url, '')), '') IS NULL
        ),
        'owner_google_connected', public.meeting_calendar_owner_has_google_connection(
            v_meeting.calendar_owner_id
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_get_live_context(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_get_live_context(UUID) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_get_live_context(UUID) IS
    'Participant live context including Meet provision status. Never returns Google tokens.';

-- Harden attach: keep service_role JWT gate; mark ready when URL attached.
CREATE OR REPLACE FUNCTION public.meeting_calendar_attach_system_meet_url(
    p_meeting_id UUID,
    p_meet_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_meet_url TEXT;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.meeting_format <> 'online' THEN
        RAISE EXCEPTION 'Meet URL can only be attached to online meetings.' USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.current_state <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Meet URL can only be attached after final confirmation.' USING ERRCODE = 'P0001';
    END IF;

    -- Idempotent: same URL already attached.
    IF v_meeting.meet_url IS NOT NULL
       AND v_meeting.meet_url = public.meeting_calendar_normalize_meet_url(p_meet_url)
    THEN
        UPDATE public.meetings
        SET
            meet_provision_status = 'ready',
            meet_provision_error = NULL,
            meet_provisioned_at = COALESCE(meet_provisioned_at, NOW()),
            updated_at = NOW()
        WHERE id = p_meeting_id;

        RETURN jsonb_build_object('ok', true, 'meeting_id', p_meeting_id, 'idempotent', true);
    END IF;

    IF NULLIF(btrim(COALESCE(v_meeting.meet_url, '')), '') IS NOT NULL THEN
        RAISE EXCEPTION 'Meet URL is already attached.' USING ERRCODE = 'P0001';
    END IF;

    v_meet_url := public.meeting_calendar_normalize_meet_url(p_meet_url);

    UPDATE public.meetings
    SET
        meet_url = v_meet_url,
        meet_provision_status = 'ready',
        meet_provision_error = NULL,
        meet_provisioned_at = NOW(),
        updated_at = NOW()
    WHERE id = p_meeting_id;

    RETURN jsonb_build_object('ok', true, 'meeting_id', p_meeting_id);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_attach_system_meet_url(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_attach_system_meet_url(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_attach_system_meet_url(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_attach_system_meet_url(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.meeting_calendar_attach_system_meet_url(UUID, TEXT) IS
    'Service-role JWT only. Attaches participant Meet join URL; idempotent for same URL.';

-- Edge Function (Phase 3): meeting-meet-provisioner claims pending outbox rows.
-- No database cron is configured by this migration.
