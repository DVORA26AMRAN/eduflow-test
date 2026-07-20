-- =============================================================================
-- EduFlow — Meeting Calendar Phase 5: Automatic Reminder Engine
-- =============================================================================
-- In-app reminders for CONFIRMED meetings only (24h and 1h before start).
-- Scheduling is backend-owned (SQL + dispatch RPC). UI must not generate reminders.
-- Reschedule overlay keeps existing reminders until replacement is confirmed.
-- Cancellation cancels all future (pending) reminders.
-- Reuses public.notifications — no parallel notification system.
-- DO NOT APPLY until architecture review approval.
-- No email / SMS / push. No external calendar integrations.

-- -----------------------------------------------------------------------------
-- Extend notification types for meeting reminders
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
            'MEETING_REMINDER'
        )
    );

-- One notification per (user, source reminder). Prevents duplicate reminder delivery.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_source_reminder_uidx
    ON public.notifications (
        user_id,
        ((metadata ->> 'source_reminder_id'))
    )
    WHERE metadata ? 'source_reminder_id';

-- -----------------------------------------------------------------------------
-- Reminder ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.meeting_reminders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id      UUID NOT NULL REFERENCES public.meetings (id) ON DELETE CASCADE,
    institution_id  UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    slot_id         UUID NOT NULL REFERENCES public.meeting_slots (id) ON DELETE CASCADE,
    reminder_kind   TEXT NOT NULL,
    scheduled_for   TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    sent_at         TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT meeting_reminders_kind_valid CHECK (reminder_kind IN ('24h', '1h')),
    CONSTRAINT meeting_reminders_status_valid CHECK (status IN ('pending', 'sent', 'cancelled')),
    CONSTRAINT meeting_reminders_sent_requires_sent_at CHECK (
        (status = 'sent' AND sent_at IS NOT NULL)
        OR (status <> 'sent')
    ),
    CONSTRAINT meeting_reminders_cancelled_requires_cancelled_at CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL)
        OR (status <> 'cancelled')
    ),
    CONSTRAINT meeting_reminders_meeting_slot_kind_unique UNIQUE (meeting_id, slot_id, reminder_kind)
);

COMMENT ON TABLE public.meeting_reminders IS
    'Phase 5: scheduled in-app reminders for confirmed meeting slots (24h / 1h).';

CREATE INDEX IF NOT EXISTS meeting_reminders_dispatch_idx
    ON public.meeting_reminders (status, scheduled_for)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS meeting_reminders_meeting_id_idx
    ON public.meeting_reminders (meeting_id);

CREATE INDEX IF NOT EXISTS meeting_reminders_slot_id_idx
    ON public.meeting_reminders (slot_id);

ALTER TABLE public.meeting_reminders ENABLE ROW LEVEL SECURITY;

-- Participants may read their meeting reminders; mutations are SECURITY DEFINER only.
DROP POLICY IF EXISTS meeting_reminders_select_participants ON public.meeting_reminders;
CREATE POLICY meeting_reminders_select_participants
    ON public.meeting_reminders
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings AS m
            WHERE m.id = meeting_reminders.meeting_id
              AND auth.uid() IN (
                  m.requester_id,
                  m.recipient_id,
                  m.calendar_owner_id,
                  m.creator_id
              )
        )
    );

REVOKE ALL ON TABLE public.meeting_reminders FROM PUBLIC;
GRANT SELECT ON TABLE public.meeting_reminders TO authenticated;

-- -----------------------------------------------------------------------------
-- Notify ALL meeting participants (system reminders have no human actor)
-- Idempotent on metadata.source_reminder_id
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_notify_meeting_participants(
    p_meeting_id UUID,
    p_notification_type TEXT,
    p_title TEXT,
    p_message TEXT,
    p_metadata JSONB DEFAULT '{}'::JSONB,
    p_source_reminder_id UUID DEFAULT NULL
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

    IF p_source_reminder_id IS NOT NULL THEN
        v_metadata := v_metadata || jsonb_build_object(
            'source_reminder_id', p_source_reminder_id::TEXT
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
    LOOP
        IF p_source_reminder_id IS NOT NULL
           AND EXISTS (
                SELECT 1
                FROM public.notifications AS n
                WHERE n.user_id = v_user_id
                  AND n.metadata ->> 'source_reminder_id' = p_source_reminder_id::TEXT
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
                NULL;
        END;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_notify_meeting_participants(UUID, TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Cancel pending reminders for a meeting (cancellation cleanup)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_cancel_pending_reminders_for_meeting(
    p_meeting_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE public.meeting_reminders
    SET
        status = 'cancelled',
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE meeting_id = p_meeting_id
      AND status = 'pending';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_cancel_pending_reminders_for_meeting(UUID) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Cancel pending reminders for a superseded confirmed slot
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_cancel_pending_reminders_for_slot(
    p_slot_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE public.meeting_reminders
    SET
        status = 'cancelled',
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE slot_id = p_slot_id
      AND status = 'pending';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_cancel_pending_reminders_for_slot(UUID) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Schedule 24h / 1h reminders for a confirmed slot
-- Rules (relative to p_reference_now, typically confirmation time):
--   - if starts_at - now < 1h  → create none
--   - if starts_at - now < 24h → skip 24h, create 1h
--   - otherwise                → create both
-- Duplicate-safe via unique (meeting_id, slot_id, reminder_kind) + ON CONFLICT
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_schedule_reminders_for_slot(
    p_meeting_id UUID,
    p_slot_id UUID,
    p_reference_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_slot public.meeting_slots%ROWTYPE;
    v_now TIMESTAMPTZ;
    v_lead INTERVAL;
    v_created_24h BOOLEAN := FALSE;
    v_created_1h BOOLEAN := FALSE;
BEGIN
    v_now := COALESCE(p_reference_now, NOW());

    SELECT * INTO v_meeting
    FROM public.meetings
    WHERE id = p_meeting_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'meeting_not_found');
    END IF;

    IF v_meeting.current_state <> 'CONFIRMED' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'meeting_not_confirmed');
    END IF;

    SELECT * INTO v_slot
    FROM public.meeting_slots
    WHERE id = p_slot_id
      AND meeting_id = p_meeting_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found');
    END IF;

    IF v_slot.slot_status <> 'confirmed' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'slot_not_confirmed');
    END IF;

    IF v_meeting.confirmed_slot_id IS DISTINCT FROM p_slot_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'slot_not_active_confirmed');
    END IF;

    v_lead := v_slot.starts_at - v_now;

    -- Meeting starts in less than 1 hour: do not generate any reminder.
    IF v_lead < INTERVAL '1 hour' THEN
        RETURN jsonb_build_object(
            'ok', true,
            'created_24h', false,
            'created_1h', false,
            'skipped_reason', 'less_than_1h'
        );
    END IF;

    -- 24h reminder only when confirmation is at least 24h before start.
    IF v_lead >= INTERVAL '24 hours' THEN
        INSERT INTO public.meeting_reminders (
            meeting_id,
            institution_id,
            slot_id,
            reminder_kind,
            scheduled_for,
            status
        ) VALUES (
            p_meeting_id,
            v_meeting.institution_id,
            p_slot_id,
            '24h',
            v_slot.starts_at - INTERVAL '24 hours',
            'pending'
        )
        ON CONFLICT (meeting_id, slot_id, reminder_kind) DO UPDATE
        SET
            scheduled_for = EXCLUDED.scheduled_for,
            status = 'pending',
            sent_at = NULL,
            cancelled_at = NULL,
            updated_at = NOW()
        WHERE public.meeting_reminders.status = 'cancelled';

        v_created_24h := EXISTS (
            SELECT 1
            FROM public.meeting_reminders
            WHERE meeting_id = p_meeting_id
              AND slot_id = p_slot_id
              AND reminder_kind = '24h'
              AND status = 'pending'
        );
    END IF;

    INSERT INTO public.meeting_reminders (
        meeting_id,
        institution_id,
        slot_id,
        reminder_kind,
        scheduled_for,
        status
    ) VALUES (
        p_meeting_id,
        v_meeting.institution_id,
        p_slot_id,
        '1h',
        v_slot.starts_at - INTERVAL '1 hour',
        'pending'
    )
    ON CONFLICT (meeting_id, slot_id, reminder_kind) DO UPDATE
    SET
        scheduled_for = EXCLUDED.scheduled_for,
        status = 'pending',
        sent_at = NULL,
        cancelled_at = NULL,
        updated_at = NOW()
    WHERE public.meeting_reminders.status = 'cancelled';

    v_created_1h := EXISTS (
        SELECT 1
        FROM public.meeting_reminders
        WHERE meeting_id = p_meeting_id
          AND slot_id = p_slot_id
          AND reminder_kind = '1h'
          AND status = 'pending'
    );

    RETURN jsonb_build_object(
        'ok', true,
        'created_24h', v_created_24h,
        'created_1h', v_created_1h,
        'skipped_reason', CASE
            WHEN v_lead < INTERVAL '24 hours' THEN 'less_than_24h'
            ELSE NULL
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_schedule_reminders_for_slot(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Dispatch due reminders → existing notifications table
-- Callable by service_role / cron / edge function only.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_dispatch_due_reminders(
    p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ;
    v_reminder public.meeting_reminders%ROWTYPE;
    v_meeting public.meetings%ROWTYPE;
    v_slot public.meeting_slots%ROWTYPE;
    v_title TEXT;
    v_message TEXT;
    v_dispatched INTEGER := 0;
    v_skipped INTEGER := 0;
    v_cancelled INTEGER := 0;
BEGIN
    v_now := COALESCE(p_now, NOW());

    FOR v_reminder IN
        SELECT *
        FROM public.meeting_reminders
        WHERE status = 'pending'
          AND scheduled_for <= v_now
        ORDER BY scheduled_for ASC
        FOR UPDATE SKIP LOCKED
    LOOP
        SELECT * INTO v_meeting
        FROM public.meetings
        WHERE id = v_reminder.meeting_id;

        IF NOT FOUND OR v_meeting.current_state = 'CANCELLED' THEN
            UPDATE public.meeting_reminders
            SET
                status = 'cancelled',
                cancelled_at = v_now,
                updated_at = v_now
            WHERE id = v_reminder.id
              AND status = 'pending';
            v_cancelled := v_cancelled + 1;
            CONTINUE;
        END IF;

        -- Only deliver while meeting remains CONFIRMED with this slot as confirmed_slot_id.
        IF v_meeting.current_state <> 'CONFIRMED'
           OR v_meeting.confirmed_slot_id IS DISTINCT FROM v_reminder.slot_id
        THEN
            UPDATE public.meeting_reminders
            SET
                status = 'cancelled',
                cancelled_at = v_now,
                updated_at = v_now
            WHERE id = v_reminder.id
              AND status = 'pending';
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        SELECT * INTO v_slot
        FROM public.meeting_slots
        WHERE id = v_reminder.slot_id;

        IF NOT FOUND OR v_slot.slot_status <> 'confirmed' THEN
            UPDATE public.meeting_reminders
            SET
                status = 'cancelled',
                cancelled_at = v_now,
                updated_at = v_now
            WHERE id = v_reminder.id
              AND status = 'pending';
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        IF v_reminder.reminder_kind = '24h' THEN
            v_title := 'תזכורת לפגישה — בעוד 24 שעות';
            v_message := 'פגישה מאושרת תתקיים בעוד כ־24 שעות.';
        ELSE
            v_title := 'תזכורת לפגישה — בעוד שעה';
            v_message := 'פגישה מאושרת תתקיים בעוד כשעה.';
        END IF;

        PERFORM public.meeting_calendar_notify_meeting_participants(
            v_reminder.meeting_id,
            'MEETING_REMINDER',
            v_title,
            v_message,
            jsonb_build_object(
                'reminder_kind', v_reminder.reminder_kind,
                'slot_id', v_reminder.slot_id,
                'scheduled_for', v_reminder.scheduled_for,
                'starts_at', v_slot.starts_at,
                'subject', v_meeting.subject
            ),
            v_reminder.id
        );

        UPDATE public.meeting_reminders
        SET
            status = 'sent',
            sent_at = v_now,
            updated_at = v_now
        WHERE id = v_reminder.id
          AND status = 'pending';

        v_dispatched := v_dispatched + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true,
        'dispatched', v_dispatched,
        'skipped', v_skipped,
        'cancelled', v_cancelled
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_dispatch_due_reminders(TIMESTAMPTZ) FROM PUBLIC;
-- Service role (edge / cron) may execute dispatch. Authenticated clients must not.
GRANT EXECUTE ON FUNCTION public.meeting_calendar_dispatch_due_reminders(TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.meeting_calendar_dispatch_due_reminders(TIMESTAMPTZ) IS
    'Phase 5: backend scheduler entrypoint. Delivers due meeting reminders as MEETING_REMINDER notifications.';

-- -----------------------------------------------------------------------------
-- Wire into confirm: after replacement confirmed, cancel old slot reminders and
-- schedule for the new confirmed slot. During reschedule overlay (before confirm),
-- no changes — old reminders remain.
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

    -- Phase 5: after final confirmation of a replacement slot, drop previous
    -- slot reminders and schedule for the newly confirmed slot.
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

    RETURN jsonb_build_object('ok', true, 'current_state', 'CONFIRMED');
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_confirm_meeting(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_confirm_meeting(UUID) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_confirm_meeting(UUID) IS
    'Phase 5: confirms pending slot; schedules 24h/1h in-app reminders for the confirmed slot.';

-- -----------------------------------------------------------------------------
-- Wire into cancel: remove all future (pending) reminders
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

    -- Phase 5: cancel all pending reminders for this meeting.
    PERFORM public.meeting_calendar_cancel_pending_reminders_for_meeting(p_meeting_id);

    RETURN jsonb_build_object('ok', true, 'current_state', 'CANCELLED');
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_cancel_meeting(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_cancel_meeting(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_cancel_meeting(UUID, TEXT) IS
    'Phase 5: cancels meeting and removes all pending automatic reminders.';

-- -----------------------------------------------------------------------------
-- Production scheduler (authoritative — single scheduler only)
-- -----------------------------------------------------------------------------
-- Authoritative production scheduler:
--   Edge Function: meeting-reminder-dispatcher
-- It must be invoked on a schedule (Supabase scheduled functions / external cron)
-- and calls meeting_calendar_dispatch_due_reminders() with the service role.
--
-- Do NOT schedule the same dispatch RPC via a second database cron job concurrently.
-- No database cron job is configured by this migration.
-- -----------------------------------------------------------------------------
