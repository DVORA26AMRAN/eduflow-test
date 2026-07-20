-- =============================================================================
-- EduFlow — Meeting Calendar Phase 3: range / pending read contracts
-- =============================================================================
-- Backend-filtered reads for calendar grids, upcoming confirmed meetings, and
-- pending workflow lists. Do not apply until architecture review approval.

-- Helpful indexes for confirmed-slot range scans
CREATE INDEX IF NOT EXISTS idx_meeting_slots_confirmed_time_range
    ON public.meeting_slots (starts_at, ends_at)
    WHERE slot_status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_meetings_pending_states
    ON public.meetings (created_at DESC)
    WHERE current_state IN (
        'WAITING_FOR_OWNER_APPROVAL',
        'WAITING_FOR_SLOT_PROPOSAL',
        'WAITING_FOR_SLOT_SELECTION',
        'WAITING_FOR_FINAL_CONFIRMATION'
    );

-- -----------------------------------------------------------------------------
-- Confirmed meetings whose confirmed slot overlaps [p_range_start, p_range_end)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_list_confirmed_in_range(
    p_range_start TIMESTAMPTZ,
    p_range_end TIMESTAMPTZ
)
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
    slot_id UUID,
    slot_starts_at TIMESTAMPTZ,
    slot_ends_at TIMESTAMPTZ,
    slot_status TEXT,
    slot_proposal_cycle INTEGER,
    slot_created_by_user_id UUID,
    slot_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF p_range_start IS NULL OR p_range_end IS NULL OR p_range_end <= p_range_start THEN
        RAISE EXCEPTION 'Invalid calendar range.' USING ERRCODE = 'P0001';
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
        s.id,
        s.starts_at,
        s.ends_at,
        s.slot_status::TEXT,
        s.proposal_cycle,
        s.created_by_user_id,
        s.created_at
    FROM public.meetings AS m
    INNER JOIN public.meeting_slots AS s
        ON s.id = m.confirmed_slot_id
    WHERE auth.uid() IN (m.requester_id, m.recipient_id, m.calendar_owner_id, m.creator_id)
      AND m.current_state = 'CONFIRMED'
      AND s.slot_status = 'confirmed'
      AND s.starts_at < p_range_end
      AND s.ends_at > p_range_start
    ORDER BY s.starts_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_list_confirmed_in_range(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_list_confirmed_in_range(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_list_confirmed_in_range(TIMESTAMPTZ, TIMESTAMPTZ) IS
    'Phase 3: participant-scoped confirmed meetings whose confirmed slot overlaps a visible calendar range.';

-- -----------------------------------------------------------------------------
-- Upcoming confirmed meetings from a point in time forward (bounded)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_list_upcoming_confirmed(
    p_from TIMESTAMPTZ,
    p_limit INTEGER DEFAULT 50
)
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
    slot_id UUID,
    slot_starts_at TIMESTAMPTZ,
    slot_ends_at TIMESTAMPTZ,
    slot_status TEXT,
    slot_proposal_cycle INTEGER,
    slot_created_by_user_id UUID,
    slot_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF p_from IS NULL THEN
        RAISE EXCEPTION 'Invalid upcoming start time.' USING ERRCODE = 'P0001';
    END IF;

    v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);

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
        s.id,
        s.starts_at,
        s.ends_at,
        s.slot_status::TEXT,
        s.proposal_cycle,
        s.created_by_user_id,
        s.created_at
    FROM public.meetings AS m
    INNER JOIN public.meeting_slots AS s
        ON s.id = m.confirmed_slot_id
    WHERE auth.uid() IN (m.requester_id, m.recipient_id, m.calendar_owner_id, m.creator_id)
      AND m.current_state = 'CONFIRMED'
      AND s.slot_status = 'confirmed'
      AND s.starts_at >= p_from
    ORDER BY s.starts_at ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_list_upcoming_confirmed(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_list_upcoming_confirmed(TIMESTAMPTZ, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_list_upcoming_confirmed(TIMESTAMPTZ, INTEGER) IS
    'Phase 3: participant-scoped upcoming confirmed meetings from a start time, with a bounded limit.';

-- -----------------------------------------------------------------------------
-- Pending workflow meetings only (excludes confirmed history)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_list_pending_meetings()
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
    updated_at TIMESTAMPTZ
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
        m.updated_at
    FROM public.meetings AS m
    WHERE auth.uid() IN (m.requester_id, m.recipient_id, m.calendar_owner_id, m.creator_id)
      AND m.current_state IN (
          'WAITING_FOR_OWNER_APPROVAL',
          'WAITING_FOR_SLOT_PROPOSAL',
          'WAITING_FOR_SLOT_SELECTION',
          'WAITING_FOR_FINAL_CONFIRMATION'
      )
    ORDER BY m.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_list_pending_meetings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_list_pending_meetings() TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_list_pending_meetings() IS
    'Phase 3: participant-scoped pending workflow meetings without confirmed history.';
