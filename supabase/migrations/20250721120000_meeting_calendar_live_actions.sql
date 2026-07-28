-- =============================================================================
-- EduFlow — Meeting Calendar: Live Meeting Actions
-- =============================================================================
-- Adds meeting format (online / phone / in_person), connection details,
-- delay reporting, live activity auditing, and participant-only live RPCs.
-- Does NOT change scheduling workflow (create / propose / select / confirm).
-- Does NOT modify Phase 5 reminder scheduling.
-- Meet join URLs are system-managed (auto-provision after confirmation); clients
-- must not submit Meet URLs. DO NOT APPLY until architecture review approval.

-- -----------------------------------------------------------------------------
-- Schema: meeting format + connection details + latest delay
-- -----------------------------------------------------------------------------

ALTER TABLE public.meetings
    ADD COLUMN IF NOT EXISTS meeting_format TEXT NOT NULL DEFAULT 'in_person',
    ADD COLUMN IF NOT EXISTS meet_url TEXT,
    ADD COLUMN IF NOT EXISTS phone_number TEXT,
    ADD COLUMN IF NOT EXISTS delay_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS delay_reported_by_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS delay_reported_at TIMESTAMPTZ;

ALTER TABLE public.meetings
    DROP CONSTRAINT IF EXISTS meetings_format_valid;

ALTER TABLE public.meetings
    ADD CONSTRAINT meetings_format_valid CHECK (
        meeting_format IN ('online', 'phone', 'in_person')
    );

ALTER TABLE public.meetings
    DROP CONSTRAINT IF EXISTS meetings_delay_minutes_valid;

ALTER TABLE public.meetings
    ADD CONSTRAINT meetings_delay_minutes_valid CHECK (
        delay_minutes IS NULL OR delay_minutes IN (5, 10, 15)
    );

-- Online meetings may briefly lack meet_url until system provisioning completes.
ALTER TABLE public.meetings
    DROP CONSTRAINT IF EXISTS meetings_online_requires_meet_url;

ALTER TABLE public.meetings
    DROP CONSTRAINT IF EXISTS meetings_phone_requires_phone_number;

ALTER TABLE public.meetings
    ADD CONSTRAINT meetings_phone_requires_phone_number CHECK (
        meeting_format <> 'phone'
        OR (phone_number IS NOT NULL AND length(btrim(phone_number)) > 0)
    );

COMMENT ON COLUMN public.meetings.meeting_format IS
    'Live meeting modality: online (Google Meet), phone, or in_person.';
COMMENT ON COLUMN public.meetings.meet_url IS
    'System-managed participant join URL for online meetings. Never accept client entry; never log; host-only links must not be stored.';
COMMENT ON COLUMN public.meetings.phone_number IS
    'Dialable phone number for phone meetings (never log). TODO: enforce E.164 normalization.';
COMMENT ON COLUMN public.meetings.delay_minutes IS
    'Latest delay report in minutes (5/10/15); replaces previous value.';

-- -----------------------------------------------------------------------------
-- Live activity events (append-only; separate from lifecycle meeting_audit_events)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.meeting_activity_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id      UUID        NOT NULL REFERENCES public.meetings (id) ON DELETE CASCADE,
    institution_id  UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    actor_user_id   UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    event_type      TEXT        NOT NULL,
    metadata        JSONB       NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT meeting_activity_events_type_valid CHECK (
        event_type IN (
            'online_meeting_opened',
            'phone_call_started',
            'delay_reported'
        )
    )
);

COMMENT ON TABLE public.meeting_activity_events IS
    'Append-only live meeting activity trail (open Meet, start call, report delay). Does not store Meet URLs or phone numbers.';

CREATE INDEX IF NOT EXISTS idx_meeting_activity_events_meeting_id
    ON public.meeting_activity_events (meeting_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meeting_activity_events_institution_id
    ON public.meeting_activity_events (institution_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.meeting_activity_events_set_institution_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_institution_id UUID;
BEGIN
    SELECT m.institution_id
    INTO v_institution_id
    FROM public.meetings AS m
    WHERE m.id = NEW.meeting_id;

    IF v_institution_id IS NULL THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    NEW.institution_id := v_institution_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_activity_events_set_institution_id ON public.meeting_activity_events;
CREATE TRIGGER meeting_activity_events_set_institution_id
    BEFORE INSERT ON public.meeting_activity_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.meeting_activity_events_set_institution_id();

CREATE OR REPLACE FUNCTION public.enforce_meeting_activity_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Meeting activity events are append-only.'
        USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS meeting_activity_events_no_update ON public.meeting_activity_events;
CREATE TRIGGER meeting_activity_events_no_update
    BEFORE UPDATE ON public.meeting_activity_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_meeting_activity_events_append_only();

DROP TRIGGER IF EXISTS meeting_activity_events_no_delete ON public.meeting_activity_events;
CREATE TRIGGER meeting_activity_events_no_delete
    BEFORE DELETE ON public.meeting_activity_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_meeting_activity_events_append_only();

ALTER TABLE public.meeting_activity_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.meeting_activity_events TO authenticated;

DROP POLICY IF EXISTS meeting_activity_events_select_participants_only ON public.meeting_activity_events;
CREATE POLICY meeting_activity_events_select_participants_only
    ON public.meeting_activity_events
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
-- Notification type: delay reported
-- -----------------------------------------------------------------------------

ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_type_valid;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_valid CHECK (
        notification_type IN (
            'REQUEST_STATUS_CHANGED',
            'REQUEST_REMINDER',
            'SUBSTITUTE_BOARD_APPROVED',
            'REQUEST_CREATED',
            'REQUEST_MESSAGE_RECEIVED',
            'MEETING_REQUEST_RECEIVED',
            'MEETING_REQUEST_APPROVED',
            'MEETING_SLOTS_PROPOSED',
            'MEETING_SLOT_SELECTED',
            'MEETING_CONFIRMED',
            'MEETING_CANCELLED',
            'MEETING_RESCHEDULE_REQUESTED',
            'MEETING_RESCHEDULE_CONFIRMED',
            'MEETING_REMINDER',
            'MEETING_DELAY_REPORTED'
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_meeting_delay_uidx
    ON public.notifications (
        user_id,
        ((metadata ->> 'meeting_id')),
        ((metadata ->> 'delay_report_key'))
    )
    WHERE notification_type = 'MEETING_DELAY_REPORTED'
      AND metadata ? 'meeting_id'
      AND metadata ? 'delay_report_key';

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_is_meeting_participant(
    p_meeting public.meetings,
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_user_id IN (
        p_meeting.requester_id,
        p_meeting.recipient_id,
        p_meeting.calendar_owner_id,
        p_meeting.creator_id
    );
$$;

CREATE OR REPLACE FUNCTION public.meeting_calendar_assert_actor_same_institution(
    p_meeting public.meetings
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_institution_id UUID;
    v_actor_status TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT u.institution_id, u.status
    INTO v_actor_institution_id, v_actor_status
    FROM public.users AS u
    WHERE u.id = auth.uid();

    IF v_actor_institution_id IS NULL OR v_actor_status <> 'active' THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_actor_institution_id IS DISTINCT FROM p_meeting.institution_id THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_calendar_normalize_phone_number(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_phone TEXT;
BEGIN
    v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');
    IF v_phone IS NULL THEN
        RETURN NULL;
    END IF;

    -- TODO(E.164): replace this permissive dialable check with strict E.164
    -- validation/normalization (e.g. libphonenumber) before production hardening.
    IF v_phone !~ '^\+?[0-9][0-9\s\-()]{5,24}$' THEN
        RAISE EXCEPTION 'Invalid phone number.' USING ERRCODE = 'P0001';
    END IF;

    RETURN regexp_replace(v_phone, '[^0-9+]', '', 'g');
END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_calendar_normalize_meet_url(p_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_url TEXT;
    v_path TEXT;
    v_query TEXT;
BEGIN
    v_url := NULLIF(btrim(COALESCE(p_url, '')), '');
    IF v_url IS NULL THEN
        RETURN NULL;
    END IF;

    -- Allow standard join links with optional trailing slash and query params
    -- (authuser, hs, pli, etc.). Reject host/admin path segments and host query keys.
    IF v_url !~* '^https://meet\.google\.com/[a-z0-9\-]+/?(\?[A-Za-z0-9._~%/&=+\-]+)?$' THEN
        RAISE EXCEPTION 'Meet URL must be a Google Meet join link.' USING ERRCODE = 'P0001';
    END IF;

    v_path := regexp_replace(v_url, '^https://meet\.google\.com', '', 'i');
    v_path := split_part(v_path, '?', 1);
    v_query := NULLIF(split_part(regexp_replace(v_url, '^[^?]*\??', ''), '#', 1), '');

    IF v_path ~* '(host|admin|moderator)' THEN
        RAISE EXCEPTION 'Host-only Meet links are not allowed.' USING ERRCODE = 'P0001';
    END IF;

    IF v_query IS NOT NULL AND v_query ~* '(^|&)(host|admin|moderator)=' THEN
        RAISE EXCEPTION 'Host-only Meet links are not allowed.' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_url;
END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_calendar_write_activity_event(
    p_meeting_id UUID,
    p_institution_id UUID,
    p_actor_user_id UUID,
    p_event_type TEXT,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.meeting_activity_events (
        meeting_id,
        institution_id,
        actor_user_id,
        event_type,
        metadata
    ) VALUES (
        p_meeting_id,
        p_institution_id,
        p_actor_user_id,
        p_event_type,
        COALESCE(p_metadata, '{}'::JSONB)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_is_meeting_participant(public.meetings, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_assert_actor_same_institution(public.meetings) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_normalize_phone_number(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_normalize_meet_url(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_write_activity_event(UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Set connection details (calendar owner). Meet URL is system-managed — rejected.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_set_connection_details(
    p_meeting_id UUID,
    p_meeting_format TEXT,
    p_meet_url TEXT DEFAULT NULL,
    p_phone_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_format TEXT;
    v_phone TEXT;
    v_meet_url TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    v_format := lower(btrim(COALESCE(p_meeting_format, '')));
    IF v_format NOT IN ('online', 'phone', 'in_person') THEN
        RAISE EXCEPTION 'Invalid meeting format.' USING ERRCODE = 'P0001';
    END IF;

    -- Manual Meet URL entry is not allowed (auto-provision after confirmation).
    IF NULLIF(btrim(COALESCE(p_meet_url, '')), '') IS NOT NULL THEN
        RAISE EXCEPTION 'Meet URL is system-managed and cannot be set manually.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    PERFORM public.meeting_calendar_assert_actor_same_institution(v_meeting);

    IF auth.uid() IS DISTINCT FROM v_meeting.calendar_owner_id THEN
        RAISE EXCEPTION 'Only the calendar owner may set connection details.' USING ERRCODE = '42501';
    END IF;

    IF v_meeting.current_state = 'CANCELLED' THEN
        RAISE EXCEPTION 'Cannot update a cancelled meeting.' USING ERRCODE = 'P0001';
    END IF;

    IF v_format = 'online' THEN
        -- Preserve an already-provisioned system Meet URL when staying online.
        v_meet_url := CASE
            WHEN v_meeting.meeting_format = 'online' THEN v_meeting.meet_url
            ELSE NULL
        END;
        v_phone := NULL;
    ELSIF v_format = 'phone' THEN
        v_phone := public.meeting_calendar_normalize_phone_number(p_phone_number);
        v_meet_url := NULL;
    ELSE
        v_meet_url := NULL;
        v_phone := NULL;
    END IF;

    UPDATE public.meetings
    SET
        meeting_format = v_format,
        meet_url = v_meet_url,
        phone_number = v_phone,
        updated_at = NOW()
    WHERE id = p_meeting_id;

    RETURN jsonb_build_object(
        'ok', true,
        'meeting_format', v_format
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_set_connection_details(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_set_connection_details(UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_set_connection_details(UUID, TEXT, TEXT, TEXT) IS
    'Owner sets format/phone only. Meet URLs are attached by meeting_calendar_attach_system_meet_url after auto-provisioning.';

-- -----------------------------------------------------------------------------
-- System-only Meet URL attach (integration boundary for Google Meet provisioner)
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- Live context for participants (sanitized; no host links)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_get_live_context(p_meeting_id UUID)
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
            AND v_meeting.current_state <> 'CANCELLED')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_get_live_context(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_get_live_context(UUID) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_get_live_context(UUID) IS
    'Participant + same-institution live meeting context. Never logs connection details.';

-- -----------------------------------------------------------------------------
-- Record primary live action (open Meet / start phone) for activity audit
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_record_live_primary_action(
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
    v_event_type TEXT;
    v_event_id UUID;
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

    IF v_meeting.current_state <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Live actions are only available for confirmed meetings.' USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.confirmed_slot_id IS NULL THEN
        RAISE EXCEPTION 'Meeting has no confirmed slot.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_slot
    FROM public.meeting_slots
    WHERE id = v_meeting.confirmed_slot_id
      AND meeting_id = p_meeting_id
      AND slot_status = 'confirmed';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Confirmed slot not found.' USING ERRCODE = 'P0001';
    END IF;

    IF v_now < v_slot.starts_at - INTERVAL '15 minutes' OR v_now >= v_slot.ends_at THEN
        RAISE EXCEPTION 'Primary live action is outside the allowed time window.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.meeting_format = 'online' THEN
        IF v_meeting.meet_url IS NULL THEN
            RAISE EXCEPTION 'Meet link is not available yet.' USING ERRCODE = 'P0001';
        END IF;
        v_event_type := 'online_meeting_opened';
    ELSIF v_meeting.meeting_format = 'phone' THEN
        IF v_meeting.phone_number IS NULL THEN
            RAISE EXCEPTION 'Phone number is not available.' USING ERRCODE = 'P0001';
        END IF;
        v_event_type := 'phone_call_started';
    ELSE
        RAISE EXCEPTION 'No primary live action for this meeting format.' USING ERRCODE = 'P0001';
    END IF;

    -- Metadata must not include Meet URL or phone number.
    v_event_id := public.meeting_calendar_write_activity_event(
        v_meeting.id,
        v_meeting.institution_id,
        auth.uid(),
        v_event_type,
        jsonb_build_object(
            'meeting_format', v_meeting.meeting_format,
            'confirmed_slot_id', v_meeting.confirmed_slot_id
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'event_type', v_event_type,
        'activity_event_id', v_event_id,
        -- Return connection target only to the authorized participant caller.
        'meet_url', CASE WHEN v_event_type = 'online_meeting_opened' THEN v_meeting.meet_url ELSE NULL END,
        'phone_number', CASE WHEN v_event_type = 'phone_call_started' THEN v_meeting.phone_number ELSE NULL END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_record_live_primary_action(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_record_live_primary_action(UUID) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_record_live_primary_action(UUID) IS
    'Participant records online_meeting_opened or phone_call_started. Never writes connection secrets into activity metadata.';

-- -----------------------------------------------------------------------------
-- Report delay (participants only). Replaces previous delay value.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_report_delay(
    p_meeting_id UUID,
    p_delay_minutes INTEGER
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
    v_other_user_id UUID;
    v_report_key TEXT;
    v_title TEXT;
    v_message TEXT;
    v_reporter_name TEXT;
    v_activity_event_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF p_delay_minutes NOT IN (5, 10, 15) THEN
        RAISE EXCEPTION 'Delay must be 5, 10, or 15 minutes.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.meeting_calendar_is_meeting_participant(v_meeting, auth.uid()) THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    PERFORM public.meeting_calendar_assert_actor_same_institution(v_meeting);

    IF v_meeting.current_state <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Delay can only be reported for confirmed meetings.' USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.confirmed_slot_id IS NULL THEN
        RAISE EXCEPTION 'Meeting has no confirmed slot.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_slot
    FROM public.meeting_slots
    WHERE id = v_meeting.confirmed_slot_id
      AND meeting_id = p_meeting_id
      AND slot_status = 'confirmed'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Confirmed slot not found.' USING ERRCODE = 'P0001';
    END IF;

    IF v_now < v_slot.starts_at - INTERVAL '30 minutes' OR v_now >= v_slot.ends_at THEN
        RAISE EXCEPTION 'Delay can only be reported from 30 minutes before start until meeting end.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT NULLIF(btrim(COALESCE(u.full_name, '')), '')
    INTO v_reporter_name
    FROM public.users AS u
    WHERE u.id = auth.uid();

    IF v_reporter_name IS NULL THEN
        v_reporter_name := 'משתתף';
    END IF;

    UPDATE public.meetings
    SET
        delay_minutes = p_delay_minutes,
        delay_reported_by_user_id = auth.uid(),
        delay_reported_at = v_now,
        updated_at = v_now
    WHERE id = p_meeting_id;

    v_activity_event_id := public.meeting_calendar_write_activity_event(
        v_meeting.id,
        v_meeting.institution_id,
        auth.uid(),
        'delay_reported',
        jsonb_build_object(
            'delay_minutes', p_delay_minutes,
            'reported_by_display_name', v_reporter_name
        )
    );

    IF auth.uid() = v_meeting.requester_id THEN
        v_other_user_id := v_meeting.recipient_id;
    ELSIF auth.uid() = v_meeting.recipient_id THEN
        v_other_user_id := v_meeting.requester_id;
    ELSE
        v_other_user_id := v_meeting.requester_id;
        IF v_other_user_id = auth.uid() THEN
            v_other_user_id := v_meeting.recipient_id;
        END IF;
    END IF;

    v_report_key := v_meeting.id::TEXT || ':' || v_now::TEXT || ':' || p_delay_minutes::TEXT;
    v_title := 'דיווח איחור לפגישה';
    v_message := v_reporter_name || ' דיווח/ה על איחור של ' || p_delay_minutes::TEXT || ' דקות.';

    BEGIN
        INSERT INTO public.notifications (
            institution_id,
            user_id,
            notification_type,
            title,
            message,
            metadata
        ) VALUES (
            v_meeting.institution_id,
            v_other_user_id,
            'MEETING_DELAY_REPORTED',
            v_title,
            v_message,
            jsonb_build_object(
                'meeting_id', v_meeting.id,
                'delay_minutes', p_delay_minutes,
                'delay_report_key', v_report_key,
                'reported_by_user_id', auth.uid(),
                'reported_by_display_name', v_reporter_name,
                'activity_event_id', v_activity_event_id
            )
        );
    EXCEPTION
        WHEN unique_violation THEN
            NULL;
    END;

    RETURN jsonb_build_object(
        'ok', true,
        'delay_minutes', p_delay_minutes,
        'delay_reported_at', v_now,
        'activity_event_id', v_activity_event_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_report_delay(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_report_delay(UUID, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_report_delay(UUID, INTEGER) IS
    'Participant delay report for confirmed meetings. Replaces previous delay; notifies the other party with reporter display name; writes meeting_activity_events.';
