import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const approved = readFileSync(
  resolve(root, 'supabase/migrations/20250713120000_create_meeting_calendar.sql'),
  'utf8',
)

const approvedLines = approved.split(/\r?\n/)
const approvedTail = approvedLines.slice(142).join('\n')

const header = `-- =============================================================================
-- EduFlow — Meeting Calendar Phase 1 Reconciliation (Forward-Only Repair)
-- =============================================================================
-- Upgrades an existing legacy Phase 1 Meeting Calendar schema to the approved
-- architecture without dropping meetings or erasing audit history.
-- Safe to re-run: schema migration is skipped when already reconciled; command
-- layer and RLS are always refreshed.

-- -----------------------------------------------------------------------------
-- Early authorization helpers (required for preflight and data migration)
-- -----------------------------------------------------------------------------

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

CREATE OR REPLACE FUNCTION public.meeting_calendar_validate_role_pair(
    p_requester_role public.user_role,
    p_recipient_role public.user_role
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT public.meeting_calendar_validate_role_pair(
        p_requester_role::TEXT,
        p_recipient_role::TEXT
    );
$$;

CREATE OR REPLACE FUNCTION public.meeting_calendar_resolve_calendar_owner_user_id(
    p_requester_id UUID,
    p_recipient_id UUID,
    p_requester_role public.user_role,
    p_recipient_role public.user_role
)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT public.meeting_calendar_resolve_calendar_owner_user_id(
        p_requester_id,
        p_recipient_id,
        p_requester_role::TEXT,
        p_recipient_role::TEXT
    );
$$;

-- -----------------------------------------------------------------------------
-- Legacy schema reconciliation (skipped when already reconciled)
-- -----------------------------------------------------------------------------

DO $reconcile$
DECLARE
    v_already_reconciled BOOLEAN;
    v_conflict TEXT;
BEGIN
    SELECT
        EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'meetings'
              AND column_name = 'active_proposal_cycle'
        )
        AND NOT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'meeting_participants'
        )
    INTO v_already_reconciled;

    IF v_already_reconciled THEN
        RAISE NOTICE 'Meeting Calendar schema already reconciled; skipping data migration.';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'meetings'
    ) THEN
        RAISE EXCEPTION 'Meeting Calendar repair requires an existing meetings table.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Same-role and unsupported participant combinations
    SELECT string_agg(m.id::TEXT, ', ')
    INTO v_conflict
    FROM public.meetings AS m
    INNER JOIN public.users AS requester ON requester.id = m.requester_id
    INNER JOIN public.users AS recipient ON recipient.id = m.recipient_id
    WHERE NOT public.meeting_calendar_validate_role_pair(requester.primary_role, recipient.primary_role);

    IF v_conflict IS NOT NULL THEN
        RAISE EXCEPTION
            'Unsupported legacy meeting participant combinations (meeting ids: %).',
            v_conflict
            USING ERRCODE = 'P0001';
    END IF;

    -- Duplicate participant table must match meetings row before removal
  IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'meeting_participants'
    ) THEN
        SELECT string_agg(conflict_row, '; ')
        INTO v_conflict
        FROM (
            SELECT m.id::TEXT || ' participant mismatch' AS conflict_row
            FROM public.meetings AS m
            WHERE EXISTS (
                SELECT 1
                FROM public.meeting_participants AS mp
                WHERE mp.meeting_id = m.id
                  AND mp.participant_role = 'creator'
                  AND mp.user_id IS DISTINCT FROM m.creator_id
            )
            OR EXISTS (
                SELECT 1
                FROM public.meeting_participants AS mp
                WHERE mp.meeting_id = m.id
                  AND mp.participant_role = 'requester'
                  AND mp.user_id IS DISTINCT FROM m.requester_id
            )
            OR EXISTS (
                SELECT 1
                FROM public.meeting_participants AS mp
                WHERE mp.meeting_id = m.id
                  AND mp.participant_role = 'recipient'
                  AND mp.user_id IS DISTINCT FROM m.recipient_id
            )
            OR EXISTS (
                SELECT 1
                FROM public.meeting_participants AS mp
                WHERE mp.meeting_id = m.id
                  AND mp.participant_role = 'calendar_owner'
                  AND mp.user_id IS DISTINCT FROM m.calendar_owner_id
            )
            OR (
                SELECT COUNT(*)
                FROM public.meeting_participants AS mp
                WHERE mp.meeting_id = m.id
            ) <> 4
        ) AS conflicts;

        IF v_conflict IS NOT NULL THEN
            RAISE EXCEPTION
                'meeting_participants rows conflict with meetings (%).',
                v_conflict
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Unmappable legacy states
    IF EXISTS (
        SELECT 1
        FROM public.meetings
        WHERE current_state NOT IN (
            'REQUESTED',
            'WAITING_FOR_OWNER_APPROVAL',
            'WAITING_FOR_SLOT_PROPOSAL',
            'WAITING_FOR_SLOT_SELECTION',
            'WAITING_FOR_FINAL_CONFIRMATION',
            'CONFIRMED',
            'RESCHEDULING',
            'CANCELLED',
            'COMPLETED'
        )
    ) THEN
        SELECT string_agg(id::TEXT || '=' || current_state, ', ')
        INTO v_conflict
        FROM public.meetings
        WHERE current_state NOT IN (
            'REQUESTED',
            'WAITING_FOR_OWNER_APPROVAL',
            'WAITING_FOR_SLOT_PROPOSAL',
            'WAITING_FOR_SLOT_SELECTION',
            'WAITING_FOR_FINAL_CONFIRMATION',
            'CONFIRMED',
            'RESCHEDULING',
            'CANCELLED',
            'COMPLETED'
        );

        RAISE EXCEPTION 'Unmappable legacy meeting states: %', v_conflict
            USING ERRCODE = 'P0001';
    END IF;

    -- Confirmed meetings must have a recoverable confirmed slot
    SELECT string_agg(m.id::TEXT, ', ')
    INTO v_conflict
    FROM public.meetings AS m
    WHERE m.current_state IN ('CONFIRMED', 'COMPLETED')
      AND m.selected_slot_id IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM public.meeting_audit_events AS ae
          WHERE ae.meeting_id = m.id
            AND ae.event_type = 'meeting_confirmed'
            AND NULLIF(ae.metadata ->> 'slot_id', '') IS NOT NULL
      );

    IF v_conflict IS NOT NULL THEN
        RAISE EXCEPTION
            'Confirmed meetings missing recoverable slot (meeting ids: %).',
            v_conflict
            USING ERRCODE = 'P0001';
    END IF;

    -- RESCHEDULING meetings must recover a prior confirmed slot from audit history
    SELECT string_agg(m.id::TEXT, ', ')
    INTO v_conflict
    FROM public.meetings AS m
    WHERE m.current_state = 'RESCHEDULING'
      AND NOT EXISTS (
          SELECT 1
          FROM public.meeting_audit_events AS ae
          WHERE ae.meeting_id = m.id
            AND ae.event_type = 'meeting_confirmed'
            AND NULLIF(ae.metadata ->> 'slot_id', '') IS NOT NULL
      );

    IF v_conflict IS NOT NULL THEN
        RAISE EXCEPTION
            'RESCHEDULING meetings missing recoverable confirmed slot (meeting ids: %).',
            v_conflict
            USING ERRCODE = 'P0001';
    END IF;

    PERFORM set_config('meeting_calendar.allow_state_transition', 'on', true);
    PERFORM set_config('meeting_calendar.allow_slot_mutation', 'on', true);

    -- New meetings columns
    ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS institution_timezone TEXT;
    ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS active_proposal_cycle INTEGER;
    ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS rescheduling_active BOOLEAN;
    ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS rescheduling_initiated_at TIMESTAMPTZ;
    ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS rescheduling_initiated_by_user_id UUID;
    ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS confirmed_slot_id UUID;
    ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS pending_slot_id UUID;
    ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS slot_selected_by_user_id UUID;

    ALTER TABLE public.meeting_slots ADD COLUMN IF NOT EXISTS proposal_cycle INTEGER;

    ALTER TABLE public.meeting_audit_events ADD COLUMN IF NOT EXISTS proposal_cycle INTEGER;
    ALTER TABLE public.meeting_audit_events ADD COLUMN IF NOT EXISTS slot_id UUID;

    UPDATE public.meetings
    SET institution_timezone = COALESCE(NULLIF(btrim(institution_timezone), ''), 'UTC')
    WHERE institution_timezone IS NULL OR btrim(institution_timezone) = '';

    UPDATE public.meetings AS m
    SET
        active_proposal_cycle = GREATEST(
            1,
            1 + (
                SELECT COUNT(*)
                FROM public.meeting_audit_events AS ae
                WHERE ae.meeting_id = m.id
                  AND ae.event_type = 'meeting_rescheduled'
            )
        ),
        rescheduling_active = (m.current_state = 'RESCHEDULING'),
        rescheduling_initiated_at = CASE
            WHEN m.current_state = 'RESCHEDULING' THEN (
                SELECT ae.created_at
                FROM public.meeting_audit_events AS ae
                WHERE ae.meeting_id = m.id
                  AND ae.event_type = 'meeting_rescheduled'
                ORDER BY ae.created_at DESC
                LIMIT 1
            )
            ELSE NULL
        END,
        rescheduling_initiated_by_user_id = CASE
            WHEN m.current_state = 'RESCHEDULING' THEN (
                SELECT ae.actor_user_id
                FROM public.meeting_audit_events AS ae
                WHERE ae.meeting_id = m.id
                  AND ae.event_type = 'meeting_rescheduled'
                ORDER BY ae.created_at DESC
                LIMIT 1
            )
            ELSE NULL
        END,
        confirmed_slot_id = CASE
            WHEN m.current_state IN ('CONFIRMED', 'COMPLETED', 'RESCHEDULING') THEN
                COALESCE(
                    m.selected_slot_id,
                    (
                        SELECT (ae.metadata ->> 'slot_id')::UUID
                        FROM public.meeting_audit_events AS ae
                        WHERE ae.meeting_id = m.id
                          AND ae.event_type = 'meeting_confirmed'
                        ORDER BY ae.created_at DESC
                        LIMIT 1
                    )
                )
            ELSE NULL
        END,
        pending_slot_id = CASE
            WHEN m.current_state = 'WAITING_FOR_FINAL_CONFIRMATION' THEN m.selected_slot_id
            ELSE NULL
        END,
        slot_selected_by_user_id = CASE
            WHEN m.current_state = 'WAITING_FOR_FINAL_CONFIRMATION' THEN
                public.meeting_calendar_non_owner_participant_id(
                    m.requester_id,
                    m.recipient_id,
                    public.meeting_calendar_resolve_calendar_owner_user_id(
                        m.requester_id,
                        m.recipient_id,
                        requester.primary_role,
                        recipient.primary_role
                    )
                )
            ELSE NULL
        END,
        calendar_owner_id = public.meeting_calendar_resolve_calendar_owner_user_id(
            m.requester_id,
            m.recipient_id,
            requester.primary_role,
            recipient.primary_role
        ),
        current_state = CASE
            WHEN m.current_state = 'REQUESTED' THEN
                public.meeting_calendar_initial_state(
                    m.requester_id,
                    public.meeting_calendar_resolve_calendar_owner_user_id(
                        m.requester_id,
                        m.recipient_id,
                        requester.primary_role,
                        recipient.primary_role
                    )
                )
            WHEN m.current_state = 'RESCHEDULING' THEN 'CONFIRMED'
            ELSE m.current_state
        END
    FROM public.users AS requester,
         public.users AS recipient
    WHERE requester.id = m.requester_id
      AND recipient.id = m.recipient_id
      AND m.active_proposal_cycle IS NULL;

    UPDATE public.meeting_slots AS s
    SET proposal_cycle = 1 + (
        SELECT COUNT(*)
        FROM public.meeting_audit_events AS ae
        WHERE ae.meeting_id = s.meeting_id
          AND ae.event_type = 'meeting_rescheduled'
          AND ae.created_at < s.created_at
    )
    WHERE s.proposal_cycle IS NULL;

    UPDATE public.meetings
    SET
        active_proposal_cycle = 1,
        rescheduling_active = COALESCE(rescheduling_active, FALSE)
    WHERE active_proposal_cycle IS NULL;

    UPDATE public.meeting_slots
    SET proposal_cycle = 1
    WHERE proposal_cycle IS NULL;

    UPDATE public.meeting_slots AS s
    SET slot_status = 'confirmed'
    FROM public.meetings AS m
    WHERE m.id = s.meeting_id
      AND m.confirmed_slot_id = s.id
      AND m.current_state IN ('CONFIRMED', 'COMPLETED')
      AND s.slot_status IN ('selected', 'superseded', 'confirmed');

    UPDATE public.meeting_slots AS s
    SET slot_status = 'selected'
    FROM public.meetings AS m
    WHERE m.id = s.meeting_id
      AND m.pending_slot_id = s.id
      AND m.current_state = 'WAITING_FOR_FINAL_CONFIRMATION'
      AND s.slot_status = 'proposed';

    UPDATE public.meeting_audit_events AS ae
    SET
        slot_id = COALESCE(ae.slot_id, NULLIF(ae.metadata ->> 'slot_id', '')::UUID),
        proposal_cycle = COALESCE(
            ae.proposal_cycle,
            (
                SELECT m.active_proposal_cycle
                FROM public.meetings AS m
                WHERE m.id = ae.meeting_id
            ),
            1
        )
    WHERE ae.slot_id IS NULL OR ae.proposal_cycle IS NULL;

    ALTER TABLE public.meetings
        ALTER COLUMN institution_timezone SET DEFAULT 'UTC',
        ALTER COLUMN institution_timezone SET NOT NULL,
        ALTER COLUMN active_proposal_cycle SET DEFAULT 1,
        ALTER COLUMN active_proposal_cycle SET NOT NULL,
        ALTER COLUMN rescheduling_active SET DEFAULT FALSE,
        ALTER COLUMN rescheduling_active SET NOT NULL;

    ALTER TABLE public.meeting_slots
        ALTER COLUMN proposal_cycle SET NOT NULL;

    ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_state_valid;
    ALTER TABLE public.meetings
        ADD CONSTRAINT meetings_state_valid CHECK (
            current_state IN (
                'WAITING_FOR_OWNER_APPROVAL',
                'WAITING_FOR_SLOT_PROPOSAL',
                'WAITING_FOR_SLOT_SELECTION',
                'WAITING_FOR_FINAL_CONFIRMATION',
                'CONFIRMED',
                'CANCELLED',
                'COMPLETED'
            )
        );

    ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_rescheduling_metadata_paired;
    ALTER TABLE public.meetings
        ADD CONSTRAINT meetings_rescheduling_metadata_paired CHECK (
            (rescheduling_active = FALSE AND rescheduling_initiated_at IS NULL AND rescheduling_initiated_by_user_id IS NULL)
            OR (rescheduling_active = TRUE AND rescheduling_initiated_at IS NOT NULL AND rescheduling_initiated_by_user_id IS NOT NULL)
        );

    ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_active_proposal_cycle_positive;
    ALTER TABLE public.meetings
        ADD CONSTRAINT meetings_active_proposal_cycle_positive CHECK (active_proposal_cycle >= 1);

    ALTER TABLE public.meeting_slots DROP CONSTRAINT IF EXISTS meeting_slots_status_valid;
    ALTER TABLE public.meeting_slots
        ADD CONSTRAINT meeting_slots_status_valid CHECK (
            slot_status IN ('proposed', 'selected', 'confirmed', 'superseded', 'rejected', 'expired')
        );

    ALTER TABLE public.meeting_slots DROP CONSTRAINT IF EXISTS meeting_slots_proposal_cycle_positive;
    ALTER TABLE public.meeting_slots
        ADD CONSTRAINT meeting_slots_proposal_cycle_positive CHECK (proposal_cycle >= 1);

    ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_selected_slot_fk;
    ALTER TABLE public.meetings DROP COLUMN IF EXISTS selected_slot_id;

    ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_confirmed_slot_fk;
    ALTER TABLE public.meetings
        ADD CONSTRAINT meetings_confirmed_slot_fk
        FOREIGN KEY (confirmed_slot_id) REFERENCES public.meeting_slots (id) ON DELETE RESTRICT;

    ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_pending_slot_fk;
    ALTER TABLE public.meetings
        ADD CONSTRAINT meetings_pending_slot_fk
        FOREIGN KEY (pending_slot_id) REFERENCES public.meeting_slots (id) ON DELETE RESTRICT;

    ALTER TABLE public.meeting_slots DROP CONSTRAINT IF EXISTS meeting_slots_unique_window;
    ALTER TABLE public.meeting_slots
        ADD CONSTRAINT meeting_slots_unique_window
        UNIQUE (meeting_id, proposal_cycle, starts_at, ends_at);

    CREATE INDEX IF NOT EXISTS idx_meetings_confirmed_slot_id ON public.meetings (confirmed_slot_id);
    CREATE INDEX IF NOT EXISTS idx_meeting_slots_meeting_cycle_status
        ON public.meeting_slots (meeting_id, proposal_cycle, slot_status);
    CREATE INDEX IF NOT EXISTS idx_meeting_slots_confirmed_overlap
        ON public.meeting_slots (institution_id, starts_at, ends_at)
        WHERE slot_status = 'confirmed';

    DROP TRIGGER IF EXISTS meeting_participants_set_institution_id ON public.meeting_participants;
    DROP POLICY IF EXISTS meeting_participants_select_authorized ON public.meeting_participants;
    REVOKE ALL ON public.meeting_participants FROM authenticated;
    DROP TABLE IF EXISTS public.meeting_participants;

    DROP POLICY IF EXISTS meetings_select_authorized ON public.meetings;
    DROP POLICY IF EXISTS meeting_slots_select_authorized ON public.meeting_slots;
    DROP POLICY IF EXISTS meeting_audit_events_select_authorized ON public.meeting_audit_events;

    DROP FUNCTION IF EXISTS public.meeting_calendar_actor_can_read_meeting(UUID);
    DROP FUNCTION IF EXISTS public.meeting_calendar_resolve_calendar_owner_id(UUID, UUID, TEXT, TEXT);
    DROP FUNCTION IF EXISTS public.meeting_calendar_write_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB);
    DROP FUNCTION IF EXISTS public.meeting_calendar_transition_state(UUID, TEXT, TEXT, UUID, TEXT, JSONB);
    REVOKE ALL ON FUNCTION public.meeting_calendar_create_meeting(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
    DROP FUNCTION IF EXISTS public.meeting_calendar_create_meeting(UUID, TEXT, TEXT, INTEGER);
END;
$reconcile$;

-- -----------------------------------------------------------------------------
-- Approved command layer, guards, and participant-only RLS (always refreshed)
-- -----------------------------------------------------------------------------
`

const tailWithTriggerGuards = approvedTail
  .replace(
    'CREATE TRIGGER meeting_slots_set_institution_id',
    'DROP TRIGGER IF EXISTS meeting_slots_set_institution_id ON public.meeting_slots;\nCREATE TRIGGER meeting_slots_set_institution_id',
  )
  .replace(
    'CREATE TRIGGER meeting_audit_events_set_institution_id',
    'DROP TRIGGER IF EXISTS meeting_audit_events_set_institution_id ON public.meeting_audit_events;\nCREATE TRIGGER meeting_audit_events_set_institution_id',
  )
  .replace(
    'CREATE TRIGGER meetings_enforce_command_only_state_updates',
    'DROP TRIGGER IF EXISTS meetings_enforce_command_only_state_updates ON public.meetings;\nCREATE TRIGGER meetings_enforce_command_only_state_updates',
  )
  .replace(
    'CREATE TRIGGER meeting_audit_events_no_update',
    'DROP TRIGGER IF EXISTS meeting_audit_events_no_update ON public.meeting_audit_events;\nCREATE TRIGGER meeting_audit_events_no_update',
  )
  .replace(
    'CREATE TRIGGER meeting_audit_events_no_delete',
    'DROP TRIGGER IF EXISTS meeting_audit_events_no_delete ON public.meeting_audit_events;\nCREATE TRIGGER meeting_audit_events_no_delete',
  )
  .replace(
    'CREATE TRIGGER meeting_slots_no_insert',
    'DROP TRIGGER IF EXISTS meeting_slots_no_insert ON public.meeting_slots;\nCREATE TRIGGER meeting_slots_no_insert',
  )
  .replace(
    'CREATE TRIGGER meeting_slots_no_update',
    'DROP TRIGGER IF EXISTS meeting_slots_no_update ON public.meeting_slots;\nCREATE TRIGGER meeting_slots_no_update',
  )
  .replace(
    'CREATE TRIGGER meeting_slots_no_delete',
    'DROP TRIGGER IF EXISTS meeting_slots_no_delete ON public.meeting_slots;\nCREATE TRIGGER meeting_slots_no_delete',
  )
  .replace(
    'CREATE POLICY meetings_select_participants_only',
    'DROP POLICY IF EXISTS meetings_select_participants_only ON public.meetings;\nCREATE POLICY meetings_select_participants_only',
  )
  .replace(
    'CREATE POLICY meeting_slots_select_participants_only',
    'DROP POLICY IF EXISTS meeting_slots_select_participants_only ON public.meeting_slots;\nCREATE POLICY meeting_slots_select_participants_only',
  )
  .replace(
    'CREATE POLICY meeting_audit_events_select_participants_only',
    'DROP POLICY IF EXISTS meeting_audit_events_select_participants_only ON public.meeting_audit_events;\nCREATE POLICY meeting_audit_events_select_participants_only',
  )

const output = header + '\n' + tailWithTriggerGuards

writeFileSync(
  resolve(root, 'supabase/migrations/20250713130000_reconcile_meeting_calendar_phase1.sql'),
  output,
  'utf8',
)

console.log('Wrote reconcile migration:', output.length, 'bytes')
