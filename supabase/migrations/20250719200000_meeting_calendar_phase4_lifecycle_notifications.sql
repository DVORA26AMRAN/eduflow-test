-- =============================================================================
-- EduFlow — Meeting Calendar Phase 4: lifecycle (keep CONFIRMED) + notifications
-- =============================================================================
-- Rescheduling keeps current_state = CONFIRMED for the entire overlay workflow.
-- Workflow progress is represented by rescheduling_active + pending_slot_id +
-- proposed slots in the active cycle (not WAITING_FOR_* demotion).
-- Calendar confirmed reads stay Phase-3-strict (CONFIRMED only).
-- Notifications reuse the existing table with audit-event idempotency.
-- DO NOT APPLY until architecture review approval.

-- -----------------------------------------------------------------------------
-- Extend notification types for meeting lifecycle
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
            'MEETING_RESCHEDULE_CONFIRMED'
        )
    );

-- One notification per (user, source audit event). Same audit row cannot fan out twice.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_source_audit_event_uidx
    ON public.notifications (
        user_id,
        ((metadata ->> 'source_audit_event_id'))
    )
    WHERE metadata ? 'source_audit_event_id';

-- -----------------------------------------------------------------------------
-- Notify other meeting participants (idempotent on source_audit_event_id)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_notify_other_participants(
    p_meeting_id UUID,
    p_actor_user_id UUID,
    p_notification_type TEXT,
    p_title TEXT,
    p_message TEXT,
    p_metadata JSONB DEFAULT '{}'::JSONB,
    p_source_audit_event_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_user_id UUID;
    v_metadata JSONB;
BEGIN
    SELECT * INTO v_meeting
    FROM public.meetings
    WHERE id = p_meeting_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_metadata := COALESCE(p_metadata, '{}'::JSONB) || jsonb_build_object('meeting_id', p_meeting_id);

    IF p_source_audit_event_id IS NOT NULL THEN
        v_metadata := v_metadata || jsonb_build_object(
            'source_audit_event_id', p_source_audit_event_id::TEXT
        );
    END IF;

    FOR v_user_id IN
        SELECT DISTINCT participant_id
        FROM (
            VALUES
                (v_meeting.requester_id),
                (v_meeting.recipient_id),
                (v_meeting.calendar_owner_id)
        ) AS participants(participant_id)
        WHERE participant_id IS DISTINCT FROM p_actor_user_id
    LOOP
        IF p_source_audit_event_id IS NOT NULL
           AND EXISTS (
                SELECT 1
                FROM public.notifications AS n
                WHERE n.user_id = v_user_id
                  AND n.metadata ->> 'source_audit_event_id' = p_source_audit_event_id::TEXT
            )
        THEN
            CONTINUE;
        END IF;

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
                v_user_id,
                p_notification_type,
                p_title,
                p_message,
                v_metadata
            );
        EXCEPTION
            WHEN unique_violation THEN
                -- Concurrent duplicate of the same audit fan-out.
                NULL;
        END;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_notify_other_participants(UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
-- Drop older 6-arg overload if present from prior Phase 4 draft
DROP FUNCTION IF EXISTS public.meeting_calendar_notify_other_participants(UUID, UUID, TEXT, TEXT, TEXT, JSONB);

-- -----------------------------------------------------------------------------
-- Audit-driven notification fan-out
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_notify_from_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_type TEXT;
    v_title TEXT;
    v_message TEXT;
    v_was_rescheduling BOOLEAN;
BEGIN
    v_was_rescheduling := COALESCE((NEW.metadata ->> 'rescheduling_active')::BOOLEAN, FALSE)
        OR (
            NEW.metadata ? 'previous_confirmed_slot_id'
            AND NEW.metadata ->> 'previous_confirmed_slot_id' IS NOT NULL
            AND NEW.metadata ->> 'previous_confirmed_slot_id' <> ''
        );

    IF NEW.event_type = 'meeting_created' THEN
        v_type := 'MEETING_REQUEST_RECEIVED';
        v_title := 'בקשת פגישה חדשה';
        v_message := 'התקבלה בקשת פגישה חדשה ביומן הפגישות.';

    ELSIF NEW.event_type = 'state_changed'
        AND NEW.from_state = 'WAITING_FOR_OWNER_APPROVAL'
        AND NEW.to_state = 'WAITING_FOR_SLOT_PROPOSAL'
    THEN
        v_type := 'MEETING_REQUEST_APPROVED';
        v_title := 'בקשת הפגישה אושרה';
        v_message := 'בעל היומן אישר את בקשת הפגישה וימשיך להצעת מועדים.';

    ELSIF NEW.event_type = 'slot_proposed' THEN
        IF COALESCE((NEW.metadata ->> 'rescheduling_active')::BOOLEAN, FALSE) THEN
            v_type := 'MEETING_RESCHEDULE_REQUESTED';
            v_title := 'הוצעו מועדים לתיאום מחדש';
            v_message := 'הוצעו מועדים חדשים לפגישה שמתואמת מחדש. יש לבחור מועד.';
        ELSE
            v_type := 'MEETING_SLOTS_PROPOSED';
            v_title := 'הוצעו מועדים לפגישה';
            v_message := 'הוצעו מועדים חדשים לפגישה. יש לבחור מועד.';
        END IF;

    ELSIF NEW.event_type = 'slot_selected' THEN
        v_type := 'MEETING_SLOT_SELECTED';
        v_title := 'נבחר מועד לפגישה';
        v_message := 'המשתתף בחר מועד וממתין לאישור סופי.';

    ELSIF NEW.event_type = 'meeting_confirmed' THEN
        IF v_was_rescheduling THEN
            v_type := 'MEETING_RESCHEDULE_CONFIRMED';
            v_title := 'התיאום מחדש אושר';
            v_message := 'הפגישה אושרה מחדש עם המועד שנבחר.';
        ELSE
            v_type := 'MEETING_CONFIRMED';
            v_title := 'הפגישה אושרה';
            v_message := 'הפגישה אושרה ומופיעה ביומן.';
        END IF;

    ELSIF NEW.event_type = 'meeting_cancelled' THEN
        v_type := 'MEETING_CANCELLED';
        v_title := 'הפגישה בוטלה';
        v_message := 'פגישה ביומן הפגישות בוטלה.';

    ELSIF NEW.event_type = 'meeting_rescheduled' THEN
        v_type := 'MEETING_RESCHEDULE_REQUESTED';
        v_title := 'התחיל תהליך תיאום מחדש';
        v_message := 'בעל היומן התחיל תיאום מחדש לפגישה מאושרת.';

    ELSE
        RETURN NEW;
    END IF;

    PERFORM public.meeting_calendar_notify_other_participants(
        NEW.meeting_id,
        NEW.actor_user_id,
        v_type,
        v_title,
        v_message,
        COALESCE(NEW.metadata, '{}'::JSONB),
        NEW.id
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_audit_events_notify ON public.meeting_audit_events;
CREATE TRIGGER meeting_audit_events_notify
    AFTER INSERT ON public.meeting_audit_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.meeting_calendar_notify_from_audit();

-- -----------------------------------------------------------------------------
-- Cancel: enforce optional reason max length (500)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_cancel_meeting(
    p_meeting_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_reason TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');

    IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Cancellation reason exceeds the maximum length of 500 characters.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.current_state IN ('CANCELLED', 'COMPLETED') THEN
        RAISE EXCEPTION 'Meeting is already terminal.' USING ERRCODE = 'P0001';
    END IF;

    IF auth.uid() IS DISTINCT FROM v_meeting.calendar_owner_id THEN
        RAISE EXCEPTION 'Only the calendar owner may cancel this meeting.' USING ERRCODE = '42501';
    END IF;

    PERFORM public.meeting_calendar_transition_state(
        p_meeting_id,
        v_meeting.current_state,
        'CANCELLED',
        auth.uid(),
        'meeting_cancelled',
        v_meeting.active_proposal_cycle,
        v_meeting.pending_slot_id,
        jsonb_build_object(
            'reason', v_reason,
            'confirmed_slot_id', v_meeting.confirmed_slot_id
        )
    );

    RETURN jsonb_build_object('ok', true, 'current_state', 'CANCELLED');
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_cancel_meeting(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_cancel_meeting(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- Propose slots: during reschedule keep current_state = CONFIRMED
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
    v_is_reschedule BOOLEAN;
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

    v_is_reschedule := (v_meeting.current_state = 'CONFIRMED' AND v_meeting.rescheduling_active);

    IF v_meeting.current_state = 'WAITING_FOR_SLOT_PROPOSAL' THEN
        v_next_state := 'WAITING_FOR_SLOT_SELECTION';
    ELSIF v_is_reschedule THEN
        -- Overlay workflow: stay CONFIRMED; progress lives in slots + pending fields.
        v_next_state := 'CONFIRMED';
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

-- -----------------------------------------------------------------------------
-- Select slot: initial booking uses WAITING_*; reschedule stays CONFIRMED
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_select_slot(
    p_meeting_id UUID,
    p_slot_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_slot public.meeting_slots%ROWTYPE;
    v_non_owner_id UUID;
    v_is_reschedule BOOLEAN;
    v_next_state TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    v_is_reschedule := (v_meeting.current_state = 'CONFIRMED' AND v_meeting.rescheduling_active);

    IF v_meeting.current_state = 'WAITING_FOR_SLOT_SELECTION' THEN
        v_next_state := 'WAITING_FOR_FINAL_CONFIRMATION';
    ELSIF v_is_reschedule THEN
        v_next_state := 'CONFIRMED';
    ELSE
        RAISE EXCEPTION 'Slots can only be selected in WAITING_FOR_SLOT_SELECTION or during an active rescheduling cycle.'
            USING ERRCODE = 'P0001';
    END IF;

    v_non_owner_id := public.meeting_calendar_non_owner_participant_id(
        v_meeting.requester_id,
        v_meeting.recipient_id,
        v_meeting.calendar_owner_id
    );

    IF auth.uid() IS DISTINCT FROM v_non_owner_id THEN
        RAISE EXCEPTION 'Only the non-calendar-owner participant may select a slot.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_slot
    FROM public.meeting_slots
    WHERE id = p_slot_id
      AND meeting_id = p_meeting_id
      AND proposal_cycle = v_meeting.active_proposal_cycle
      AND slot_status = 'proposed'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proposed slot not found in the active proposal cycle.' USING ERRCODE = 'P0002';
    END IF;

    PERFORM set_config('meeting_calendar.allow_slot_mutation', 'on', true);

    UPDATE public.meeting_slots
    SET slot_status = 'rejected'
    WHERE meeting_id = p_meeting_id
      AND proposal_cycle = v_meeting.active_proposal_cycle
      AND id <> p_slot_id
      AND slot_status = 'proposed';

    UPDATE public.meeting_slots
    SET slot_status = 'selected'
    WHERE id = p_slot_id;

    PERFORM set_config('meeting_calendar.allow_state_transition', 'on', true);

    UPDATE public.meetings
    SET
        pending_slot_id = p_slot_id,
        slot_selected_by_user_id = auth.uid(),
        current_state = v_next_state
    WHERE id = p_meeting_id;

    PERFORM public.meeting_calendar_write_audit(
        p_meeting_id,
        v_meeting.institution_id,
        auth.uid(),
        'slot_selected',
        v_meeting.current_state,
        v_next_state,
        v_meeting.active_proposal_cycle,
        p_slot_id,
        jsonb_build_object(
            'rescheduling_active', v_meeting.rescheduling_active,
            'confirmed_slot_id', v_meeting.confirmed_slot_id
        )
    );

    RETURN jsonb_build_object('ok', true, 'current_state', v_next_state);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_select_slot(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_select_slot(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Confirm: initial booking from WAITING_FOR_FINAL_CONFIRMATION;
-- reschedule confirms while staying / returning to stable CONFIRMED
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

    RETURN jsonb_build_object('ok', true, 'current_state', 'CONFIRMED');
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_confirm_meeting(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_confirm_meeting(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Pending list: include CONFIRMED meetings with active reschedule overlay
-- + active proposed-slot count for client workflow classification
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.meeting_calendar_list_pending_meetings();

CREATE FUNCTION public.meeting_calendar_list_pending_meetings()
RETURNS TABLE (
    id UUID,
    institution_id UUID,
    creator_id UUID,
    requester_id UUID,
    calendar_owner_id UUID,
    recipient_id UUID,
    subject TEXT,
    reason TEXT,
    duration_minutes INTEGER,
    institution_timezone TEXT,
    current_state TEXT,
    active_proposal_cycle INTEGER,
    rescheduling_active BOOLEAN,
    rescheduling_initiated_at TIMESTAMPTZ,
    rescheduling_initiated_by_user_id UUID,
    confirmed_slot_id UUID,
    pending_slot_id UUID,
    slot_selected_by_user_id UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    active_proposed_slot_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        m.id,
        m.institution_id,
        m.creator_id,
        m.requester_id,
        m.calendar_owner_id,
        m.recipient_id,
        m.subject::TEXT,
        m.reason::TEXT,
        m.duration_minutes,
        m.institution_timezone::TEXT,
        m.current_state::TEXT,
        m.active_proposal_cycle,
        m.rescheduling_active,
        m.rescheduling_initiated_at,
        m.rescheduling_initiated_by_user_id,
        m.confirmed_slot_id,
        m.pending_slot_id,
        m.slot_selected_by_user_id,
        m.created_at,
        m.updated_at,
        (
            SELECT COUNT(*)::INTEGER
            FROM public.meeting_slots AS s
            WHERE s.meeting_id = m.id
              AND s.proposal_cycle = m.active_proposal_cycle
              AND s.slot_status = 'proposed'
        ) AS active_proposed_slot_count
    FROM public.meetings AS m
    WHERE auth.uid() IN (m.requester_id, m.recipient_id, m.calendar_owner_id, m.creator_id)
      AND (
          m.current_state IN (
              'WAITING_FOR_OWNER_APPROVAL',
              'WAITING_FOR_SLOT_PROPOSAL',
              'WAITING_FOR_SLOT_SELECTION',
              'WAITING_FOR_FINAL_CONFIRMATION'
          )
          OR (
              m.current_state = 'CONFIRMED'
              AND m.rescheduling_active = TRUE
          )
      )
    ORDER BY m.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_list_pending_meetings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_list_pending_meetings() TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_propose_slots(UUID, JSONB) IS
    'Phase 4: initial booking advances to WAITING_FOR_SLOT_SELECTION; reschedule keeps CONFIRMED.';

COMMENT ON FUNCTION public.meeting_calendar_select_slot(UUID, UUID) IS
    'Phase 4: initial booking advances to WAITING_FOR_FINAL_CONFIRMATION; reschedule keeps CONFIRMED and sets pending_slot_id.';

COMMENT ON FUNCTION public.meeting_calendar_confirm_meeting(UUID) IS
    'Phase 4: confirms pending slot; clears rescheduling overlay when active; always ends CONFIRMED.';
