-- =============================================================================
-- EduFlow — Meeting Calendar Google Meet Phase 4
-- Meet provision UX audit events + live-context connection status
-- =============================================================================
-- DO NOT APPLY / DEPLOY until explicitly approved.

-- -----------------------------------------------------------------------------
-- Extend audit event allowlist (Meet provision trail)
-- -----------------------------------------------------------------------------

ALTER TABLE public.meeting_audit_events
    DROP CONSTRAINT IF EXISTS meeting_audit_events_type_valid;

ALTER TABLE public.meeting_audit_events
    ADD CONSTRAINT meeting_audit_events_type_valid CHECK (
        event_type IN (
            'meeting_created',
            'state_changed',
            'slot_proposed',
            'slot_selected',
            'meeting_confirmed',
            'meeting_cancelled',
            'meeting_rescheduled',
            'MEET_PROVISION_REQUESTED',
            'MEET_PROVISION_STARTED',
            'MEET_PROVISION_READY',
            'MEET_PROVISION_FAILED',
            'MEET_PROVISION_RETRY',
            'MEET_REAUTH_REQUIRED'
        )
    );

COMMENT ON CONSTRAINT meeting_audit_events_type_valid ON public.meeting_audit_events IS
    'Meeting workflow + Meet provision audit event types. Meet metadata must never include tokens or Meet URLs.';

-- -----------------------------------------------------------------------------
-- Sanitize Meet audit metadata (never tokens / Meet URL / auth codes)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_sanitize_meet_audit_metadata(
    p_metadata JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_src JSONB := COALESCE(p_metadata, '{}'::JSONB);
    v_out JSONB := '{}'::JSONB;
    v_key TEXT;
    v_val JSONB;
    v_text TEXT;
BEGIN
    IF jsonb_typeof(v_src) <> 'object' THEN
        RETURN '{}'::JSONB;
    END IF;

    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_src)
    LOOP
        -- Deny-list sensitive / provider-internal keys (case-insensitive).
        IF lower(v_key) ~ '(token|refresh|access_token|id_token|authorization|auth_code|code_verifier|ciphertext|nonce|meet_url|hangout|join_url|password|secret|bearer)' THEN
            CONTINUE;
        END IF;

        -- Allow only a small safe whitelist.
        IF v_key NOT IN (
            'trigger_source',
            'error_code',
            'attempt_count',
            'outbox_status',
            'google_connected',
            'enqueued',
            'idempotent'
        ) THEN
            CONTINUE;
        END IF;

        IF jsonb_typeof(v_val) = 'string' THEN
            v_text := v_val #>> '{}';
            -- Strip accidental URLs / JWT-looking blobs from string values.
            IF v_text ~* 'https?://' OR v_text ~ 'eyJ[A-Za-z0-9_-]+\.' THEN
                CONTINUE;
            END IF;
        END IF;

        v_out := v_out || jsonb_build_object(v_key, v_val);
    END LOOP;

    RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_sanitize_meet_audit_metadata(JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.meeting_calendar_write_meet_provision_audit(
    p_meeting_id UUID,
    p_institution_id UUID,
    p_actor_user_id UUID,
    p_event_type TEXT,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_event_type NOT IN (
        'MEET_PROVISION_REQUESTED',
        'MEET_PROVISION_STARTED',
        'MEET_PROVISION_READY',
        'MEET_PROVISION_FAILED',
        'MEET_PROVISION_RETRY',
        'MEET_REAUTH_REQUIRED'
    ) THEN
        RAISE EXCEPTION 'Invalid Meet provision audit event type.' USING ERRCODE = 'P0001';
    END IF;

    IF p_meeting_id IS NULL OR p_institution_id IS NULL OR p_actor_user_id IS NULL THEN
        RETURN;
    END IF;

    PERFORM public.meeting_calendar_write_audit(
        p_meeting_id,
        p_institution_id,
        p_actor_user_id,
        p_event_type,
        NULL,
        NULL,
        NULL,
        NULL,
        public.meeting_calendar_sanitize_meet_audit_metadata(p_metadata)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_write_meet_provision_audit(
    UUID, UUID, UUID, TEXT, JSONB
) FROM PUBLIC;

COMMENT ON FUNCTION public.meeting_calendar_write_meet_provision_audit(UUID, UUID, UUID, TEXT, JSONB) IS
    'Append Meet provision audit event with sanitized metadata (no tokens / Meet URLs / auth codes).';

-- -----------------------------------------------------------------------------
-- Owner Google connection status for UX (never tokens)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_owner_google_connection_status(
    p_owner_user_id UUID
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1
            FROM public.user_google_connections AS c
            WHERE c.user_id = p_owner_user_id
              AND c.revoked_at IS NULL
              AND c.authorization_status IS DISTINCT FROM 'revoked'
        ) THEN 'not_connected'
        WHEN EXISTS (
            SELECT 1
            FROM public.user_google_connections AS c
            WHERE c.user_id = p_owner_user_id
              AND c.revoked_at IS NULL
              AND c.authorization_status = 'active'
              AND c.refresh_token_ciphertext IS NOT NULL
              AND c.refresh_token_nonce IS NOT NULL
        ) THEN 'connected'
        ELSE 'reauthorization_required'
    END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_owner_google_connection_status(UUID) FROM PUBLIC;

COMMENT ON FUNCTION public.meeting_calendar_owner_google_connection_status(UUID) IS
    'Returns connected | not_connected | reauthorization_required. Never exposes tokens.';

-- -----------------------------------------------------------------------------
-- Sync: emit REQUESTED / RETRY audit (no secrets)
-- -----------------------------------------------------------------------------

-- Preserve Phase 1 parameter defaults. PostgreSQL 42P13 rejects CREATE OR REPLACE
-- that removes defaults from an existing function; never DROP ... CASCADE.
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
    v_actor UUID;
    v_audit_event TEXT;
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
        v_outbox_status := 'awaiting_connection';
        v_meeting_status := 'google_not_connected';
    END IF;

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

    v_actor := COALESCE(auth.uid(), p_calendar_owner_id);
    v_audit_event := CASE
        WHEN p_trigger_source = 'retry' THEN 'MEET_PROVISION_RETRY'
        ELSE 'MEET_PROVISION_REQUESTED'
    END;

    PERFORM public.meeting_calendar_write_meet_provision_audit(
        p_meeting_id,
        p_institution_id,
        v_actor,
        v_audit_event,
        jsonb_build_object(
            'trigger_source', p_trigger_source,
            'enqueued', (v_outbox_status = 'pending'),
            'google_connected', v_connected,
            'outbox_status', v_outbox_status
        )
    );

    IF NOT v_connected
       AND public.meeting_calendar_owner_google_connection_status(p_calendar_owner_id)
           = 'reauthorization_required'
    THEN
        PERFORM public.meeting_calendar_write_meet_provision_audit(
            p_meeting_id,
            p_institution_id,
            v_actor,
            'MEET_REAUTH_REQUIRED',
            jsonb_build_object(
                'trigger_source', p_trigger_source,
                'error_code', 'REAUTHORIZATION_REQUIRED'
            )
        );
    END IF;

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
-- Claim: STARTED audit
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
    v_owner UUID;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
    v_lease := make_interval(secs => GREATEST(15, LEAST(COALESCE(p_lease_seconds, 60), 300)));

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

        SELECT calendar_owner_id INTO v_owner
        FROM public.meetings
        WHERE id = v_row.meeting_id;

        IF v_owner IS NOT NULL THEN
            PERFORM public.meeting_calendar_write_meet_provision_audit(
                v_row.meeting_id,
                v_row.institution_id,
                v_owner,
                'MEET_PROVISION_STARTED',
                jsonb_build_object(
                    'attempt_count', v_row.attempt_count,
                    'outbox_status', 'processing'
                )
            );
        END IF;

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

-- -----------------------------------------------------------------------------
-- Complete: READY audit (no Meet URL in metadata)
-- -----------------------------------------------------------------------------

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
    v_owner UUID;
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

    SELECT calendar_owner_id INTO v_owner
    FROM public.meetings
    WHERE id = v_req.meeting_id;

    IF v_owner IS NOT NULL THEN
        PERFORM public.meeting_calendar_write_meet_provision_audit(
            v_req.meeting_id,
            v_req.institution_id,
            v_owner,
            'MEET_PROVISION_READY',
            jsonb_build_object(
                'outbox_status', 'succeeded',
                'idempotent', COALESCE((v_attach ->> 'idempotent')::BOOLEAN, false)
            )
        );
    END IF;

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

-- -----------------------------------------------------------------------------
-- Fail: FAILED / REAUTH audit (sanitized error_code only)
-- -----------------------------------------------------------------------------

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
    v_owner UUID;
    v_error TEXT;
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
    v_next_status := CASE WHEN v_delay > 0 THEN 'pending' ELSE 'failed' END;
    v_error := left(NULLIF(btrim(COALESCE(p_error, '')), ''), 120);
    -- Never persist URL-looking fragments in durable error text.
    v_error := regexp_replace(COALESCE(v_error, ''), 'https?://\S+', '[REDACTED]', 'gi');

    UPDATE public.meeting_meet_provision_requests
    SET
        status = v_next_status,
        last_error = v_error,
        next_attempt_at = NOW() + make_interval(secs => v_delay),
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
    WHERE id = p_request_id;

    UPDATE public.meetings
    SET
        meet_provision_status = CASE
            WHEN v_error IN ('REAUTHORIZATION_REQUIRED', 'GOOGLE_NOT_CONNECTED')
                THEN 'google_not_connected'
            ELSE 'failed'
        END,
        meet_provision_error = v_error,
        updated_at = NOW()
    WHERE id = v_req.meeting_id
      AND meet_provision_status IS DISTINCT FROM 'ready';

    IF v_next_status = 'failed' THEN
        SELECT calendar_owner_id INTO v_owner
        FROM public.meetings
        WHERE id = v_req.meeting_id;

        IF v_owner IS NOT NULL THEN
            IF v_error IN ('REAUTHORIZATION_REQUIRED', 'GOOGLE_NOT_CONNECTED') THEN
                PERFORM public.meeting_calendar_write_meet_provision_audit(
                    v_req.meeting_id,
                    v_req.institution_id,
                    v_owner,
                    'MEET_REAUTH_REQUIRED',
                    jsonb_build_object('error_code', COALESCE(v_error, 'REAUTHORIZATION_REQUIRED'))
                );
            ELSE
                PERFORM public.meeting_calendar_write_meet_provision_audit(
                    v_req.meeting_id,
                    v_req.institution_id,
                    v_owner,
                    'MEET_PROVISION_FAILED',
                    jsonb_build_object(
                        'error_code', COALESCE(v_error, 'provision_failed'),
                        'outbox_status', 'failed'
                    )
                );
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'status', v_next_status,
        'meet_provision_status', CASE
            WHEN v_error IN ('REAUTHORIZATION_REQUIRED', 'GOOGLE_NOT_CONNECTED')
                THEN 'google_not_connected'
            ELSE 'failed'
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_fail_meet_provision(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_fail_meet_provision(UUID, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_fail_meet_provision(UUID, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_fail_meet_provision(UUID, TEXT, INTEGER) TO service_role;

-- -----------------------------------------------------------------------------
-- Live context: provision + owner connection status for Meeting Details UX
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
    v_primary_available BOOLEAN := false;
    v_delay_available BOOLEAN := false;
    v_owner_connection_status TEXT;
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

    v_owner_connection_status := public.meeting_calendar_owner_google_connection_status(
        v_meeting.calendar_owner_id
    );

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
        'is_calendar_owner', (auth.uid() = v_meeting.calendar_owner_id),
        'owner_google_connected', public.meeting_calendar_owner_has_google_connection(
            v_meeting.calendar_owner_id
        ),
        'owner_google_connection_status', v_owner_connection_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_get_live_context(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_get_live_context(UUID) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_get_live_context(UUID) IS
    'Participant live context including Meet provision + owner Google connection status. Never returns Google tokens or exposes provider internals beyond join URL when ready.';
