import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const meetingCalendarMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250713120000_create_meeting_calendar.sql',
)
const secretaryHelperMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250713101500_create_auth_user_is_active_secretary_for_institution.sql',
)

describe('meeting calendar migration compliance', () => {
  const migration = readFileSync(meetingCalendarMigrationPath, 'utf8')
  const secretaryHelperMigration = readFileSync(secretaryHelperMigrationPath, 'utf8')

  it('creates independent meeting tables without a duplicate participant table', () => {
    expect(migration).toContain('CREATE TABLE public.meetings')
    expect(migration).toContain('CREATE TABLE public.meeting_slots')
    expect(migration).toContain('CREATE TABLE public.meeting_audit_events')
    expect(migration).not.toContain('CREATE TABLE public.meeting_participants')
    expect(migration).not.toContain('public.requests')
  })

  it('removes the unused REQUESTED state and RESCHEDULING meeting state', () => {
    expect(migration).not.toContain("'REQUESTED'")
    expect(migration).not.toContain("'RESCHEDULING'")
    expect(migration).toContain('rescheduling_active')
    expect(migration).toContain('active_proposal_cycle')
    expect(migration).toContain('confirmed_slot_id')
  })

  it('enforces command-only workflow and append-only audit', () => {
    expect(migration).toContain('enforce_meetings_command_only_state_updates')
    expect(migration).toContain('enforce_meeting_audit_events_append_only')
    expect(migration).toContain('enforce_meeting_slots_command_only_mutations')
    expect(migration).not.toContain('GRANT INSERT ON public.meeting_audit_events')
  })

  it('restricts reads to participants only', () => {
    expect(migration).toContain('meeting_calendar_actor_is_participant')
    expect(migration).toContain('meetings_select_participants_only')
    expect(migration).not.toContain('auth_user_is_active_institution_manager_for_institution(m.institution_id)')
  })

  it('derives calendar ownership from participant roles', () => {
    expect(migration).toContain('meeting_calendar_resolve_calendar_owner_user_id')
    expect(migration).toMatch(/meeting_calendar_validate_role_pair[\s\S]*p_requester_role = p_recipient_role/)
    expect(migration).toContain("p_requester_role = 'institution_manager'")
    expect(migration).toContain("p_requester_role = 'secretary'")
  })

  it('requires the non-owner participant to confirm and checks overlap transactionally', () => {
    expect(migration).toContain('Only the slot selector may confirm the meeting.')
    expect(migration).toContain('meeting_calendar_participant_has_confirmed_overlap')
    expect(migration).toMatch(/meeting_calendar_confirm_meeting[\s\S]*FOR UPDATE/)
  })

  it('restricts cancellation and rescheduling to the calendar owner', () => {
    expect(migration).toContain('Only the calendar owner may cancel this meeting.')
    expect(migration).toContain('Only the calendar owner may initiate rescheduling.')
    expect(migration).toMatch(/meeting_calendar_reschedule_meeting[\s\S]*confirmed_slot_id/)
  })

  it('versions the secretary institution helper in source control', () => {
    expect(secretaryHelperMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.auth_user_is_active_secretary_for_institution',
    )
  })
})
