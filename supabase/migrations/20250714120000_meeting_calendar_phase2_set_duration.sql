-- =============================================================================
-- EduFlow — Meeting Calendar Phase 2: nullable duration + owner set_duration
-- =============================================================================
-- Workflow B (non-calendar-owner initiates) creates meetings with
-- duration_minutes = NULL. Only the calendar owner may set a valid duration
-- before proposing slots.
-- DO NOT APPLY until architecture review approval.

-- -----------------------------------------------------------------------------
-- Schema: allow NULL duration until the calendar owner sets it
-- -----------------------------------------------------------------------------

ALTER TABLE public.meetings
    ALTER COLUMN duration_minutes DROP NOT NULL;

ALTER TABLE public.meetings
    DROP CONSTRAINT IF EXISTS meetings_duration_valid;

ALTER TABLE public.meetings
    ADD CONSTRAINT meetings_duration_valid CHECK (
        duration_minutes IS NULL
        OR duration_minutes IN (15, 30, 45, 60)
    );

COMMENT ON COLUMN public.meetings.duration_minutes IS
    'Meeting duration in minutes. NULL until the calendar owner sets it (Workflow B).';

-- -----------------------------------------------------------------------------
-- Create meeting: owner must provide duration; non-owner must pass NULL
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_create_meeting(
    p_recipient_id UUID,
    p_subject TEXT,
    p_reason TEXT,
    p_duration_minutes INTEGER,
    p_institution_timezone TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_institution_id UUID;
    v_actor_role TEXT;
    v_actor_status TEXT;
    v_recipient_institution_id UUID;
    v_recipient_role TEXT;
    v_recipient_status TEXT;
    v_meeting_id UUID;
    v_calendar_owner_id UUID;
    v_initial_state TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT institution_id, primary_role, status
    INTO v_actor_institution_id, v_actor_role, v_actor_status
    FROM public.meeting_calendar_user_profile(auth.uid());

    SELECT institution_id, primary_role, status
    INTO v_recipient_institution_id, v_recipient_role, v_recipient_status
    FROM public.meeting_calendar_user_profile(p_recipient_id);

    IF v_actor_institution_id IS NULL OR v_actor_status <> 'active' THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_recipient_institution_id IS NULL OR v_recipient_status <> 'active' THEN
        RAISE EXCEPTION 'Recipient is not an active user.' USING ERRCODE = 'P0001';
    END IF;

    IF v_actor_institution_id IS DISTINCT FROM v_recipient_institution_id THEN
        RAISE EXCEPTION 'Cross-institution meetings are not allowed.' USING ERRCODE = 'P0001';
    END IF;

    IF auth.uid() = p_recipient_id THEN
        RAISE EXCEPTION 'Requester and recipient must be different users.' USING ERRCODE = 'P0001';
    END IF;

    IF btrim(COALESCE(p_subject, '')) = '' OR btrim(COALESCE(p_reason, '')) = '' THEN
        RAISE EXCEPTION 'Subject and reason are required.' USING ERRCODE = 'P0001';
    END IF;

    IF char_length(btrim(p_subject)) > 150 THEN
        RAISE EXCEPTION 'Subject exceeds the maximum length of 150 characters.' USING ERRCODE = 'P0001';
    END IF;

    IF char_length(btrim(p_reason)) > 1000 THEN
        RAISE EXCEPTION 'Reason exceeds the maximum length of 1000 characters.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.meeting_calendar_validate_role_pair(v_actor_role, v_recipient_role) THEN
        RAISE EXCEPTION 'Unauthorized role combination.' USING ERRCODE = '42501';
    END IF;

    v_calendar_owner_id := public.meeting_calendar_resolve_calendar_owner_user_id(
        auth.uid(),
        p_recipient_id,
        v_actor_role,
        v_recipient_role
    );

    v_initial_state := public.meeting_calendar_initial_state(auth.uid(), v_calendar_owner_id);

    IF auth.uid() = v_calendar_owner_id THEN
        IF p_duration_minutes IS NULL OR p_duration_minutes NOT IN (15, 30, 45, 60) THEN
            RAISE EXCEPTION 'Invalid meeting duration.' USING ERRCODE = 'P0001';
        END IF;
    ELSE
        IF p_duration_minutes IS NOT NULL THEN
            RAISE EXCEPTION 'Only the calendar owner may set the meeting duration.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    INSERT INTO public.meetings (
        institution_id,
        creator_id,
        requester_id,
        calendar_owner_id,
        recipient_id,
        subject,
        reason,
        duration_minutes,
        institution_timezone,
        current_state
    ) VALUES (
        v_actor_institution_id,
        auth.uid(),
        auth.uid(),
        v_calendar_owner_id,
        p_recipient_id,
        btrim(p_subject),
        btrim(p_reason),
        p_duration_minutes,
        COALESCE(NULLIF(btrim(p_institution_timezone), ''), 'UTC'),
        v_initial_state
    )
    RETURNING id INTO v_meeting_id;

    PERFORM public.meeting_calendar_write_audit(
        v_meeting_id,
        v_actor_institution_id,
        auth.uid(),
        'meeting_created',
        NULL,
        v_initial_state,
        1,
        NULL,
        jsonb_build_object(
            'requester_id', auth.uid(),
            'recipient_id', p_recipient_id,
            'calendar_owner_id', v_calendar_owner_id,
            'duration_minutes', p_duration_minutes,
            'institution_timezone', COALESCE(NULLIF(btrim(p_institution_timezone), ''), 'UTC')
        )
    );

    RETURN jsonb_build_object('ok', true, 'meeting_id', v_meeting_id, 'current_state', v_initial_state);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_create_meeting(UUID, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_create_meeting(UUID, TEXT, TEXT, INTEGER, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- Calendar owner sets duration before proposing slots
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_set_duration(
    p_meeting_id UUID,
    p_duration_minutes INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF p_duration_minutes NOT IN (15, 30, 45, 60) THEN
        RAISE EXCEPTION 'Invalid meeting duration.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.calendar_owner_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Only the calendar owner may set the meeting duration.' USING ERRCODE = '42501';
    END IF;

    IF v_meeting.current_state <> 'WAITING_FOR_SLOT_PROPOSAL' THEN
        RAISE EXCEPTION 'Duration can only be set before slot proposal.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.meetings
    SET duration_minutes = p_duration_minutes
    WHERE id = p_meeting_id;

    PERFORM public.meeting_calendar_write_audit(
        p_meeting_id,
        v_meeting.institution_id,
        auth.uid(),
        'state_changed',
        v_meeting.current_state,
        v_meeting.current_state,
        v_meeting.active_proposal_cycle,
        NULL,
        jsonb_build_object(
            'previous_duration_minutes', v_meeting.duration_minutes,
            'duration_minutes', p_duration_minutes,
            'action', 'set_duration'
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'current_state', v_meeting.current_state,
        'duration_minutes', p_duration_minutes
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_set_duration(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_set_duration(UUID, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_set_duration(UUID, INTEGER) IS
    'Phase 2: calendar owner sets meeting duration before proposing slots.';

-- -----------------------------------------------------------------------------
-- Propose slots: duration must already be set by the calendar owner
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_propose_slots(
    p_meeting_id UUID,
    p_slots JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_slot JSONB;
    v_starts_at TIMESTAMPTZ;
    v_ends_at TIMESTAMPTZ;
    v_slot_count INTEGER;
    v_next_state TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' THEN
        RAISE EXCEPTION 'Slots payload must be a JSON array.' USING ERRCODE = 'P0001';
    END IF;

    v_slot_count := jsonb_array_length(p_slots);

    IF v_slot_count < 1 OR v_slot_count > 5 THEN
        RAISE EXCEPTION 'Each meeting must include between 1 and 5 proposed slots.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.calendar_owner_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Only the calendar owner may propose meeting slots.' USING ERRCODE = '42501';
    END IF;

    IF v_meeting.duration_minutes IS NULL THEN
        RAISE EXCEPTION 'Meeting duration must be set before proposing slots.' USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.current_state = 'WAITING_FOR_SLOT_PROPOSAL' THEN
        v_next_state := 'WAITING_FOR_SLOT_SELECTION';
    ELSIF v_meeting.current_state = 'CONFIRMED' AND v_meeting.rescheduling_active THEN
        v_next_state := 'WAITING_FOR_SLOT_SELECTION';
    ELSE
        RAISE EXCEPTION 'Slots can only be proposed in WAITING_FOR_SLOT_PROPOSAL or during an active rescheduling cycle.'
            USING ERRCODE = 'P0001';
    END IF;

    PERFORM set_config('meeting_calendar.allow_slot_mutation', 'on', true);

    UPDATE public.meeting_slots
    SET slot_status = 'expired'
    WHERE meeting_id = p_meeting_id
      AND proposal_cycle = v_meeting.active_proposal_cycle
      AND slot_status IN ('proposed', 'selected');

    FOR v_slot IN SELECT value FROM jsonb_array_elements(p_slots)
    LOOP
        v_starts_at := (v_slot ->> 'starts_at')::TIMESTAMPTZ;
        v_ends_at := (v_slot ->> 'ends_at')::TIMESTAMPTZ;

        IF v_starts_at IS NULL OR v_ends_at IS NULL THEN
            RAISE EXCEPTION 'Each slot must include starts_at and ends_at.' USING ERRCODE = 'P0001';
        END IF;

        IF v_ends_at <= v_starts_at THEN
            RAISE EXCEPTION 'Invalid slot date range.' USING ERRCODE = 'P0001';
        END IF;

        IF v_starts_at < NOW() THEN
            RAISE EXCEPTION 'Past slot dates are not allowed.' USING ERRCODE = 'P0001';
        END IF;

        IF v_ends_at <> (v_starts_at + make_interval(mins => v_meeting.duration_minutes)) THEN
            RAISE EXCEPTION 'Slot duration must match meeting duration.' USING ERRCODE = 'P0001';
        END IF;

        INSERT INTO public.meeting_slots (
            meeting_id,
            institution_id,
            proposal_cycle,
            starts_at,
            ends_at,
            slot_status,
            created_by_user_id
        ) VALUES (
            p_meeting_id,
            v_meeting.institution_id,
            v_meeting.active_proposal_cycle,
            v_starts_at,
            v_ends_at,
            'proposed',
            auth.uid()
        );
    END LOOP;

    PERFORM set_config('meeting_calendar.allow_state_transition', 'on', true);

    UPDATE public.meetings
    SET
        pending_slot_id = NULL,
        slot_selected_by_user_id = NULL,
        current_state = v_next_state
    WHERE id = p_meeting_id;

    PERFORM public.meeting_calendar_write_audit(
        p_meeting_id,
        v_meeting.institution_id,
        auth.uid(),
        'slot_proposed',
        v_meeting.current_state,
        v_next_state,
        v_meeting.active_proposal_cycle,
        NULL,
        jsonb_build_object(
            'slot_count', v_slot_count,
            'rescheduling_active', v_meeting.rescheduling_active,
            'confirmed_slot_id', v_meeting.confirmed_slot_id
        )
    );

    RETURN jsonb_build_object('ok', true, 'current_state', v_next_state);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_propose_slots(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_propose_slots(UUID, JSONB) TO authenticated;
