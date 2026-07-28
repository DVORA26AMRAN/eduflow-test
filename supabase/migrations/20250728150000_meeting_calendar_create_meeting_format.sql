-- =============================================================================
-- EduFlow — Meeting Calendar: meeting type at initial creation
-- =============================================================================
-- Extends meeting_calendar_create_meeting to require meeting_format (and phone
-- number when format = phone). Meet URLs remain system-managed (rejected if
-- supplied by clients). Does not change role permissions, institution checks,
-- slot proposal, or confirmation workflow.
-- DO NOT APPLY until architecture review approval.

DROP FUNCTION IF EXISTS public.meeting_calendar_create_meeting(UUID, TEXT, TEXT, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.meeting_calendar_create_meeting(
    p_recipient_id UUID,
    p_subject TEXT,
    p_reason TEXT,
    p_duration_minutes INTEGER,
    p_institution_timezone TEXT DEFAULT 'UTC',
    p_meeting_format TEXT DEFAULT NULL,
    p_phone_number TEXT DEFAULT NULL,
    p_meet_url TEXT DEFAULT NULL
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
    v_format TEXT;
    v_phone TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    -- Manual Meet URL entry is never allowed at creation.
    IF NULLIF(btrim(COALESCE(p_meet_url, '')), '') IS NOT NULL THEN
        RAISE EXCEPTION 'Meet URL is system-managed and cannot be set manually.'
            USING ERRCODE = 'P0001';
    END IF;

    v_format := lower(btrim(COALESCE(p_meeting_format, '')));
    IF v_format NOT IN ('online', 'phone', 'in_person') THEN
        RAISE EXCEPTION 'Meeting format is required.' USING ERRCODE = 'P0001';
    END IF;

    IF v_format = 'phone' THEN
        v_phone := public.meeting_calendar_normalize_phone_number(p_phone_number);
        IF v_phone IS NULL THEN
            RAISE EXCEPTION 'Phone number is required for phone meetings.' USING ERRCODE = 'P0001';
        END IF;
    ELSIF v_format = 'online' THEN
        v_phone := NULL;
    ELSE
        v_phone := NULL;
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
        current_state,
        meeting_format,
        phone_number,
        meet_url
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
        v_initial_state,
        v_format,
        v_phone,
        NULL
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
            'meeting_format', v_format,
            'institution_timezone', COALESCE(NULLIF(btrim(p_institution_timezone), ''), 'UTC')
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'meeting_id', v_meeting_id,
        'current_state', v_initial_state,
        'meeting_format', v_format
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_create_meeting(
    UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_create_meeting(
    UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_create_meeting(
    UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT
) IS
    'Creates a meeting with required meeting_format. Phone meetings require phone_number. Meet URLs are never accepted from clients.';
