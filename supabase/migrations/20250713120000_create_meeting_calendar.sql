-- =============================================================================
-- EduFlow — Meeting Calendar Phase 1 (Architecture-Compliant Foundation)
-- =============================================================================
-- Independent module. All mutations via SECURITY DEFINER RPC commands.
-- meetings is the authoritative participant source (no duplicate participant table).

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

CREATE TABLE public.meetings (
    id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id                  UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    creator_id                      UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    requester_id                    UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    calendar_owner_id               UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    recipient_id                    UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    subject                         TEXT        NOT NULL,
    reason                          TEXT        NOT NULL,
    duration_minutes                INTEGER     NOT NULL,
    institution_timezone            TEXT        NOT NULL DEFAULT 'UTC',
    current_state                   TEXT        NOT NULL,
    active_proposal_cycle           INTEGER     NOT NULL DEFAULT 1,
    rescheduling_active             BOOLEAN     NOT NULL DEFAULT FALSE,
    rescheduling_initiated_at       TIMESTAMPTZ,
    rescheduling_initiated_by_user_id UUID      REFERENCES public.users (id) ON DELETE RESTRICT,
    confirmed_slot_id               UUID,
    pending_slot_id                 UUID,
    slot_selected_by_user_id        UUID        REFERENCES public.users (id) ON DELETE RESTRICT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT meetings_subject_not_blank CHECK (btrim(subject) <> ''),
    CONSTRAINT meetings_reason_not_blank CHECK (btrim(reason) <> ''),
    CONSTRAINT meetings_duration_valid CHECK (duration_minutes IN (15, 30, 45, 60)),
    CONSTRAINT meetings_active_proposal_cycle_positive CHECK (active_proposal_cycle >= 1),
    CONSTRAINT meetings_state_valid CHECK (
        current_state IN (
            'WAITING_FOR_OWNER_APPROVAL',
            'WAITING_FOR_SLOT_PROPOSAL',
            'WAITING_FOR_SLOT_SELECTION',
            'WAITING_FOR_FINAL_CONFIRMATION',
            'CONFIRMED',
            'CANCELLED',
            'COMPLETED'
        )
    ),
    CONSTRAINT meetings_calendar_owner_is_party CHECK (
        calendar_owner_id IN (requester_id, recipient_id)
    ),
    CONSTRAINT meetings_creator_is_requester CHECK (creator_id = requester_id),
    CONSTRAINT meetings_parties_distinct CHECK (requester_id <> recipient_id),
    CONSTRAINT meetings_rescheduling_metadata_paired CHECK (
        (rescheduling_active = FALSE AND rescheduling_initiated_at IS NULL AND rescheduling_initiated_by_user_id IS NULL)
        OR (rescheduling_active = TRUE AND rescheduling_initiated_at IS NOT NULL AND rescheduling_initiated_by_user_id IS NOT NULL)
    )
);

COMMENT ON TABLE public.meetings IS
    'Meeting Calendar meetings. Authoritative participant relationships live on this row.';

CREATE INDEX idx_meetings_institution_id ON public.meetings (institution_id);
CREATE INDEX idx_meetings_institution_state ON public.meetings (institution_id, current_state);
CREATE INDEX idx_meetings_requester_id ON public.meetings (requester_id);
CREATE INDEX idx_meetings_recipient_id ON public.meetings (recipient_id);
CREATE INDEX idx_meetings_calendar_owner_id ON public.meetings (calendar_owner_id);
CREATE INDEX idx_meetings_confirmed_slot_id ON public.meetings (confirmed_slot_id);

CREATE TRIGGER meetings_set_updated_at
    BEFORE UPDATE ON public.meetings
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();

CREATE TABLE public.meeting_slots (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id          UUID        NOT NULL REFERENCES public.meetings (id) ON DELETE CASCADE,
    institution_id      UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    proposal_cycle      INTEGER     NOT NULL,
    starts_at           TIMESTAMPTZ NOT NULL,
    ends_at             TIMESTAMPTZ NOT NULL,
    slot_status         TEXT        NOT NULL DEFAULT 'proposed',
    created_by_user_id  UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT meeting_slots_status_valid CHECK (
        slot_status IN ('proposed', 'selected', 'confirmed', 'superseded', 'rejected', 'expired')
    ),
    CONSTRAINT meeting_slots_range_valid CHECK (ends_at > starts_at),
    CONSTRAINT meeting_slots_proposal_cycle_positive CHECK (proposal_cycle >= 1),
    CONSTRAINT meeting_slots_unique_window UNIQUE (meeting_id, proposal_cycle, starts_at, ends_at)
);

COMMENT ON TABLE public.meeting_slots IS
    'Proposed, selected, and confirmed meeting slots with explicit proposal-cycle identifiers.';

CREATE INDEX idx_meeting_slots_meeting_id ON public.meeting_slots (meeting_id);
CREATE INDEX idx_meeting_slots_institution_id ON public.meeting_slots (institution_id);
CREATE INDEX idx_meeting_slots_meeting_cycle_status ON public.meeting_slots (meeting_id, proposal_cycle, slot_status);
CREATE INDEX idx_meeting_slots_confirmed_overlap ON public.meeting_slots (institution_id, starts_at, ends_at)
    WHERE slot_status = 'confirmed';

ALTER TABLE public.meetings
    ADD CONSTRAINT meetings_confirmed_slot_fk
    FOREIGN KEY (confirmed_slot_id) REFERENCES public.meeting_slots (id) ON DELETE RESTRICT;

ALTER TABLE public.meetings
    ADD CONSTRAINT meetings_pending_slot_fk
    FOREIGN KEY (pending_slot_id) REFERENCES public.meeting_slots (id) ON DELETE RESTRICT;

CREATE TABLE public.meeting_audit_events (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id          UUID        NOT NULL REFERENCES public.meetings (id) ON DELETE CASCADE,
    institution_id      UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    actor_user_id       UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    event_type          TEXT        NOT NULL,
    from_state          TEXT,
    to_state            TEXT,
    proposal_cycle      INTEGER,
    slot_id             UUID,
    metadata            JSONB       NOT NULL DEFAULT '{}'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT meeting_audit_events_type_valid CHECK (
        event_type IN (
            'meeting_created',
            'state_changed',
            'slot_proposed',
            'slot_selected',
            'meeting_confirmed',
            'meeting_cancelled',
            'meeting_rescheduled'
        )
    )
);

COMMENT ON TABLE public.meeting_audit_events IS
    'Append-only Meeting Calendar audit trail.';

CREATE INDEX idx_meeting_audit_events_meeting_id ON public.meeting_audit_events (meeting_id);
CREATE INDEX idx_meeting_audit_events_institution_id ON public.meeting_audit_events (institution_id);

-- -----------------------------------------------------------------------------
-- Slot / audit denormalization
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_slots_set_institution_id()
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

CREATE TRIGGER meeting_slots_set_institution_id
    BEFORE INSERT ON public.meeting_slots
    FOR EACH ROW
    EXECUTE PROCEDURE public.meeting_slots_set_institution_id();

CREATE OR REPLACE FUNCTION public.meeting_audit_events_set_institution_id()
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

CREATE TRIGGER meeting_audit_events_set_institution_id
    BEFORE INSERT ON public.meeting_audit_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.meeting_audit_events_set_institution_id();

-- -----------------------------------------------------------------------------
-- Direct mutation guards
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_meetings_command_only_state_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (
        OLD.current_state IS DISTINCT FROM NEW.current_state
        OR OLD.confirmed_slot_id IS DISTINCT FROM NEW.confirmed_slot_id
        OR OLD.pending_slot_id IS DISTINCT FROM NEW.pending_slot_id
        OR OLD.slot_selected_by_user_id IS DISTINCT FROM NEW.slot_selected_by_user_id
        OR OLD.active_proposal_cycle IS DISTINCT FROM NEW.active_proposal_cycle
        OR OLD.rescheduling_active IS DISTINCT FROM NEW.rescheduling_active
        OR OLD.rescheduling_initiated_at IS DISTINCT FROM NEW.rescheduling_initiated_at
        OR OLD.rescheduling_initiated_by_user_id IS DISTINCT FROM NEW.rescheduling_initiated_by_user_id
    ) AND current_setting('meeting_calendar.allow_state_transition', true) IS DISTINCT FROM 'on'
    THEN
        RAISE EXCEPTION 'Direct meeting workflow updates are prohibited. Use Meeting Calendar commands.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER meetings_enforce_command_only_state_updates
    BEFORE UPDATE ON public.meetings
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_meetings_command_only_state_updates();

CREATE OR REPLACE FUNCTION public.enforce_meeting_audit_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Meeting audit events are append-only.'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER meeting_audit_events_no_update
    BEFORE UPDATE ON public.meeting_audit_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_meeting_audit_events_append_only();

CREATE TRIGGER meeting_audit_events_no_delete
    BEFORE DELETE ON public.meeting_audit_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_meeting_audit_events_append_only();

CREATE OR REPLACE FUNCTION public.enforce_meeting_slots_command_only_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_setting('meeting_calendar.allow_slot_mutation', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Direct meeting slot mutations are prohibited. Use Meeting Calendar commands.'
            USING ERRCODE = '42501';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER meeting_slots_no_insert
    BEFORE INSERT ON public.meeting_slots
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_meeting_slots_command_only_mutations();

CREATE TRIGGER meeting_slots_no_update
    BEFORE UPDATE ON public.meeting_slots
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_meeting_slots_command_only_mutations();

CREATE TRIGGER meeting_slots_no_delete
    BEFORE DELETE ON public.meeting_slots
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_meeting_slots_command_only_mutations();

-- -----------------------------------------------------------------------------
-- Authorization helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_user_profile(p_user_id UUID)
RETURNS TABLE (
    user_id UUID,
    institution_id UUID,
    primary_role TEXT,
    status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.institution_id, u.primary_role, u.status
    FROM public.users AS u
    WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_user_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_user_profile(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.meeting_calendar_actor_is_participant(p_meeting_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.meetings AS m
        WHERE m.id = p_meeting_id
          AND auth.uid() IN (m.requester_id, m.recipient_id, m.calendar_owner_id, m.creator_id)
    );
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_actor_is_participant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_actor_is_participant(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.meeting_calendar_validate_role_pair(
    p_requester_role TEXT,
    p_recipient_role TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_requester_role = p_recipient_role THEN
        RETURN FALSE;
    END IF;

    IF p_requester_role = 'platform_admin' OR p_recipient_role = 'platform_admin' THEN
        RETURN FALSE;
    END IF;

    IF p_requester_role = 'teacher' AND p_recipient_role IN ('secretary', 'institution_manager') THEN
        RETURN TRUE;
    END IF;

    IF p_requester_role = 'secretary' AND p_recipient_role IN ('teacher', 'institution_manager') THEN
        RETURN TRUE;
    END IF;

    IF p_requester_role = 'institution_manager' AND p_recipient_role IN ('teacher', 'secretary') THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_calendar_resolve_calendar_owner_user_id(
    p_requester_id UUID,
    p_recipient_id UUID,
    p_requester_role TEXT,
    p_recipient_role TEXT
)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_requester_role = 'institution_manager' OR p_recipient_role = 'institution_manager' THEN
        IF p_requester_role = 'institution_manager' THEN
            RETURN p_requester_id;
        END IF;
        RETURN p_recipient_id;
    END IF;

    IF p_requester_role = 'secretary' OR p_recipient_role = 'secretary' THEN
        IF p_requester_role = 'secretary' THEN
            RETURN p_requester_id;
        END IF;
        RETURN p_recipient_id;
    END IF;

    RAISE EXCEPTION 'Unsupported participant combination.'
        USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_calendar_non_owner_participant_id(
    p_requester_id UUID,
    p_recipient_id UUID,
    p_calendar_owner_id UUID
)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_calendar_owner_id = p_requester_id THEN p_recipient_id
        ELSE p_requester_id
    END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_calendar_initial_state(
    p_requester_id UUID,
    p_calendar_owner_id UUID
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_requester_id = p_calendar_owner_id THEN 'WAITING_FOR_SLOT_PROPOSAL'
        ELSE 'WAITING_FOR_OWNER_APPROVAL'
    END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_calendar_write_audit(
    p_meeting_id UUID,
    p_institution_id UUID,
    p_actor_user_id UUID,
    p_event_type TEXT,
    p_from_state TEXT,
    p_to_state TEXT,
    p_proposal_cycle INTEGER DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.meeting_audit_events (
        meeting_id,
        institution_id,
        actor_user_id,
        event_type,
        from_state,
        to_state,
        proposal_cycle,
        slot_id,
        metadata
    ) VALUES (
        p_meeting_id,
        p_institution_id,
        p_actor_user_id,
        p_event_type,
        p_from_state,
        p_to_state,
        p_proposal_cycle,
        p_slot_id,
        COALESCE(p_metadata, '{}'::JSONB)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_write_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID, JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.meeting_calendar_participant_has_confirmed_overlap(
    p_user_id UUID,
    p_starts_at TIMESTAMPTZ,
    p_ends_at TIMESTAMPTZ,
    p_exclude_meeting_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.meetings AS m
        INNER JOIN public.meeting_slots AS s ON s.id = m.confirmed_slot_id
        WHERE m.id <> p_exclude_meeting_id
          AND m.current_state = 'CONFIRMED'
          AND p_user_id IN (m.requester_id, m.recipient_id, m.calendar_owner_id)
          AND s.slot_status = 'confirmed'
          AND s.starts_at < p_ends_at
          AND s.ends_at > p_starts_at
    );
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_participant_has_confirmed_overlap(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.meeting_calendar_transition_state(
    p_meeting_id UUID,
    p_expected_from TEXT,
    p_next_state TEXT,
    p_actor_user_id UUID,
    p_event_type TEXT,
    p_proposal_cycle INTEGER DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS public.meetings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
BEGIN
    SELECT *
    INTO v_meeting
    FROM public.meetings
    WHERE id = p_meeting_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.current_state IS DISTINCT FROM p_expected_from THEN
        RAISE EXCEPTION 'Invalid meeting state transition from % to %.', v_meeting.current_state, p_next_state
            USING ERRCODE = 'P0001';
    END IF;

    PERFORM set_config('meeting_calendar.allow_state_transition', 'on', true);

    UPDATE public.meetings
    SET current_state = p_next_state
    WHERE id = p_meeting_id
    RETURNING * INTO v_meeting;

    PERFORM public.meeting_calendar_write_audit(
        p_meeting_id,
        v_meeting.institution_id,
        p_actor_user_id,
        p_event_type,
        p_expected_from,
        p_next_state,
        p_proposal_cycle,
        p_slot_id,
        p_metadata
    );

    RETURN v_meeting;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_transition_state(UUID, TEXT, TEXT, UUID, TEXT, INTEGER, UUID, JSONB) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Commands (RPC)
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

    IF p_duration_minutes NOT IN (15, 30, 45, 60) THEN
        RAISE EXCEPTION 'Invalid meeting duration.' USING ERRCODE = 'P0001';
    END IF;

    IF btrim(COALESCE(p_subject, '')) = '' OR btrim(COALESCE(p_reason, '')) = '' THEN
        RAISE EXCEPTION 'Subject and reason are required.' USING ERRCODE = 'P0001';
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

CREATE OR REPLACE FUNCTION public.meeting_calendar_approve_by_owner(p_meeting_id UUID)
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

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.calendar_owner_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Only the calendar owner may approve this meeting.' USING ERRCODE = '42501';
    END IF;

    PERFORM public.meeting_calendar_transition_state(
        p_meeting_id,
        'WAITING_FOR_OWNER_APPROVAL',
        'WAITING_FOR_SLOT_PROPOSAL',
        auth.uid(),
        'state_changed',
        v_meeting.active_proposal_cycle,
        NULL,
        '{}'::JSONB
    );

    RETURN jsonb_build_object('ok', true, 'current_state', 'WAITING_FOR_SLOT_PROPOSAL');
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_approve_by_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_approve_by_owner(UUID) TO authenticated;

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
    v_duration_minutes INTEGER;
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

        v_duration_minutes := EXTRACT(EPOCH FROM (v_ends_at - v_starts_at))::INTEGER / 60;

        IF v_duration_minutes <> v_meeting.duration_minutes THEN
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
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.current_state <> 'WAITING_FOR_SLOT_SELECTION' THEN
        RAISE EXCEPTION 'Slots can only be selected in WAITING_FOR_SLOT_SELECTION.' USING ERRCODE = 'P0001';
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
        current_state = 'WAITING_FOR_FINAL_CONFIRMATION'
    WHERE id = p_meeting_id;

    PERFORM public.meeting_calendar_write_audit(
        p_meeting_id,
        v_meeting.institution_id,
        auth.uid(),
        'slot_selected',
        'WAITING_FOR_SLOT_SELECTION',
        'WAITING_FOR_FINAL_CONFIRMATION',
        v_meeting.active_proposal_cycle,
        p_slot_id,
        '{}'::JSONB
    );

    RETURN jsonb_build_object('ok', true, 'current_state', 'WAITING_FOR_FINAL_CONFIRMATION');
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_select_slot(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_select_slot(UUID, UUID) TO authenticated;

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
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.current_state <> 'WAITING_FOR_FINAL_CONFIRMATION' THEN
        RAISE EXCEPTION 'Meeting is not awaiting final confirmation.' USING ERRCODE = 'P0001';
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
        'WAITING_FOR_FINAL_CONFIRMATION',
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
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
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
            'reason', NULLIF(btrim(COALESCE(p_reason, '')), ''),
            'confirmed_slot_id', v_meeting.confirmed_slot_id
        )
    );

    RETURN jsonb_build_object('ok', true, 'current_state', 'CANCELLED');
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_cancel_meeting(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_cancel_meeting(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.meeting_calendar_reschedule_meeting(p_meeting_id UUID)
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

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.current_state <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Only confirmed meetings can enter rescheduling.' USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.confirmed_slot_id IS NULL THEN
        RAISE EXCEPTION 'Confirmed meeting is missing a confirmed slot.' USING ERRCODE = 'P0001';
    END IF;

    IF auth.uid() IS DISTINCT FROM v_meeting.calendar_owner_id THEN
        RAISE EXCEPTION 'Only the calendar owner may initiate rescheduling.' USING ERRCODE = '42501';
    END IF;

    PERFORM set_config('meeting_calendar.allow_slot_mutation', 'on', true);

    UPDATE public.meeting_slots
    SET slot_status = 'expired'
    WHERE meeting_id = p_meeting_id
      AND proposal_cycle = v_meeting.active_proposal_cycle
      AND slot_status IN ('proposed', 'selected');

    PERFORM set_config('meeting_calendar.allow_state_transition', 'on', true);

    UPDATE public.meetings
    SET
        rescheduling_active = TRUE,
        rescheduling_initiated_at = NOW(),
        rescheduling_initiated_by_user_id = auth.uid(),
        active_proposal_cycle = v_meeting.active_proposal_cycle + 1,
        pending_slot_id = NULL,
        slot_selected_by_user_id = NULL,
        current_state = 'CONFIRMED'
    WHERE id = p_meeting_id;

    PERFORM public.meeting_calendar_write_audit(
        p_meeting_id,
        v_meeting.institution_id,
        auth.uid(),
        'meeting_rescheduled',
        'CONFIRMED',
        'CONFIRMED',
        v_meeting.active_proposal_cycle + 1,
        v_meeting.confirmed_slot_id,
        jsonb_build_object(
            'previous_confirmed_slot_id', v_meeting.confirmed_slot_id,
            'rescheduling_initiated_by_user_id', auth.uid()
        )
    );

    RETURN jsonb_build_object('ok', true, 'current_state', 'CONFIRMED', 'rescheduling_active', true);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_reschedule_meeting(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_reschedule_meeting(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.meeting_calendar_complete_meeting(p_meeting_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting public.meetings%ROWTYPE;
    v_slot public.meeting_slots%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_meeting.current_state = 'COMPLETED' THEN
        RETURN jsonb_build_object('ok', true, 'current_state', 'COMPLETED');
    END IF;

    IF v_meeting.current_state <> 'CONFIRMED' OR v_meeting.rescheduling_active THEN
        RAISE EXCEPTION 'Only stable confirmed meetings can be completed.' USING ERRCODE = 'P0001';
    END IF;

    IF v_meeting.confirmed_slot_id IS NULL THEN
        RAISE EXCEPTION 'Confirmed meeting is missing a confirmed slot.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_slot FROM public.meeting_slots WHERE id = v_meeting.confirmed_slot_id;

    IF v_slot.ends_at > NOW() THEN
        RAISE EXCEPTION 'Meeting cannot be completed before it ends.' USING ERRCODE = 'P0001';
    END IF;

    IF auth.uid() NOT IN (v_meeting.requester_id, v_meeting.recipient_id, v_meeting.calendar_owner_id) THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    PERFORM public.meeting_calendar_transition_state(
        p_meeting_id,
        'CONFIRMED',
        'COMPLETED',
        auth.uid(),
        'state_changed',
        v_meeting.active_proposal_cycle,
        v_meeting.confirmed_slot_id,
        '{}'::JSONB
    );

    RETURN jsonb_build_object('ok', true, 'current_state', 'COMPLETED');
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_complete_meeting(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_complete_meeting(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security (participant read-only; writes via RPC)
-- -----------------------------------------------------------------------------

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_audit_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.meetings TO authenticated;
GRANT SELECT ON public.meeting_slots TO authenticated;
GRANT SELECT ON public.meeting_audit_events TO authenticated;

CREATE POLICY meetings_select_participants_only
    ON public.meetings
    FOR SELECT
    TO authenticated
    USING (public.meeting_calendar_actor_is_participant(id));

CREATE POLICY meeting_slots_select_participants_only
    ON public.meeting_slots
    FOR SELECT
    TO authenticated
    USING (public.meeting_calendar_actor_is_participant(meeting_id));

CREATE POLICY meeting_audit_events_select_participants_only
    ON public.meeting_audit_events
    FOR SELECT
    TO authenticated
    USING (public.meeting_calendar_actor_is_participant(meeting_id));
