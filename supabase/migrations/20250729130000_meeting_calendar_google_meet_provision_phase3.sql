-- =============================================================================
-- EduFlow — Google Meet provision Phase 3 (worker context RPCs)
-- =============================================================================
-- Supports meeting-meet-provisioner Edge Function.
-- Does NOT call Google APIs from SQL. DO NOT DEPLOY until review approval.
-- No calendar sync. Claim remains pending-only (awaiting_connection never claimed).

-- Worker context: meeting + slot + owner + existing Meet fields (service_role).
CREATE OR REPLACE FUNCTION public.meeting_calendar_service_get_meet_provision_context(
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req public.meeting_meet_provision_requests%ROWTYPE;
    v_meeting public.meetings%ROWTYPE;
    v_slot public.meeting_slots%ROWTYPE;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    SELECT * INTO v_req
    FROM public.meeting_meet_provision_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meet provision request not found.' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_meeting
    FROM public.meetings
    WHERE id = v_req.meeting_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.institution_id IS DISTINCT FROM v_req.institution_id THEN
        RAISE EXCEPTION 'Institution mismatch.' USING ERRCODE = '42501';
    END IF;

    IF v_meeting.meeting_format <> 'online' THEN
        RAISE EXCEPTION 'Meet provisioning is only for online meetings.' USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.current_state <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Meet provisioning requires a confirmed meeting.' USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.confirmed_slot_id IS DISTINCT FROM v_req.confirmed_slot_id THEN
        RAISE EXCEPTION 'Provision request slot does not match confirmed slot.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_slot
    FROM public.meeting_slots
    WHERE id = v_req.confirmed_slot_id
      AND meeting_id = v_meeting.id;

    IF NOT FOUND OR v_slot.slot_status <> 'confirmed' THEN
        RAISE EXCEPTION 'Confirmed slot is missing or invalid.' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'request', jsonb_build_object(
            'id', v_req.id,
            'status', v_req.status,
            'request_key', v_req.request_key,
            'google_event_id', v_req.google_event_id,
            'attempt_count', v_req.attempt_count,
            'institution_id', v_req.institution_id,
            'meeting_id', v_req.meeting_id,
            'confirmed_slot_id', v_req.confirmed_slot_id
        ),
        'meeting', jsonb_build_object(
            'id', v_meeting.id,
            'institution_id', v_meeting.institution_id,
            'calendar_owner_id', v_meeting.calendar_owner_id,
            'subject', v_meeting.subject,
            'meeting_format', v_meeting.meeting_format,
            'current_state', v_meeting.current_state,
            'meet_url', v_meeting.meet_url,
            'google_meet_event_id', v_meeting.google_meet_event_id,
            'google_meet_request_id', v_meeting.google_meet_request_id,
            'meet_provision_status', v_meeting.meet_provision_status,
            'institution_timezone', v_meeting.institution_timezone
        ),
        'slot', jsonb_build_object(
            'id', v_slot.id,
            'starts_at', v_slot.starts_at,
            'ends_at', v_slot.ends_at
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_get_meet_provision_context(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_get_meet_provision_context(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_get_meet_provision_context(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_get_meet_provision_context(UUID) TO service_role;

COMMENT ON FUNCTION public.meeting_calendar_service_get_meet_provision_context(UUID) IS
    'Phase 3 worker context. service_role only. Rejects non-online / non-confirmed / institution mismatch.';

-- Ensure claim never selects awaiting_connection (defense in depth comment + index).
COMMENT ON FUNCTION public.meeting_calendar_claim_meet_provision_batch(INTEGER, INTEGER, TEXT) IS
    'Claims status=pending only. awaiting_connection is never claimed. service_role JWT required.';

CREATE INDEX IF NOT EXISTS meeting_meet_provision_requests_awaiting_idx
    ON public.meeting_meet_provision_requests (status, updated_at)
    WHERE status = 'awaiting_connection';

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_set_meet_provision_status(
    p_meeting_id UUID,
    p_status TEXT,
    p_error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    IF p_status NOT IN (
        'not_applicable',
        'google_not_connected',
        'pending',
        'ready',
        'failed'
    ) THEN
        RAISE EXCEPTION 'Invalid meet_provision_status.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.meetings
    SET
        meet_provision_status = p_status,
        meet_provision_error = CASE
            WHEN p_status = 'failed' THEN NULLIF(btrim(COALESCE(p_error, '')), '')
            ELSE NULL
        END,
        updated_at = NOW()
    WHERE id = p_meeting_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object('ok', true, 'meeting_id', p_meeting_id, 'meet_provision_status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_set_meet_provision_status(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_set_meet_provision_status(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_set_meet_provision_status(UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_set_meet_provision_status(UUID, TEXT, TEXT) TO service_role;