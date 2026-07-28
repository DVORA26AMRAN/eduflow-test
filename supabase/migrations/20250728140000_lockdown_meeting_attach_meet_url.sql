-- =============================================================================
-- EduFlow — Hotfix: lock down meeting_calendar_attach_system_meet_url
-- =============================================================================
-- The live-actions migration allowed anon/authenticated callers to reach the
-- body of meeting_calendar_attach_system_meet_url because:
--   1) SECURITY DEFINER makes current_user the owner (often postgres), which
--      bypassed the intended service_role gate.
--   2) EXECUTE was not explicitly revoked from anon/authenticated.
-- Apply on staging/dev immediately. DO NOT skip before production.

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
    v_jwt_role TEXT;
BEGIN
    -- Service-role JWT only. Do not use current_user: SECURITY DEFINER runs as owner.
    v_jwt_role := COALESCE(auth.jwt() ->> 'role', auth.role());
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

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

    v_meet_url := public.meeting_calendar_normalize_meet_url(p_meet_url);

    UPDATE public.meetings
    SET
        meet_url = v_meet_url,
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
    'Integration boundary: Google Meet provisioner attaches join URL with service_role JWT only. Not callable by anon/authenticated.';
