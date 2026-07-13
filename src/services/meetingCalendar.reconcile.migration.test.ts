import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const reconcileMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250713130000_reconcile_meeting_calendar_phase1.sql',
)
const originalMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250713120000_create_meeting_calendar.sql',
)

describe('meeting calendar reconcile migration', () => {
  const migration = readFileSync(reconcileMigrationPath, 'utf8')
  const originalMigration = readFileSync(originalMigrationPath, 'utf8')

  it('is forward-only and does not drop meetings or erase audit history', () => {
    expect(migration).toContain('Meeting Calendar Phase 1 Reconciliation')
    expect(migration).not.toMatch(/DROP TABLE\s+public\.meetings/i)
    expect(migration).not.toMatch(/DELETE FROM\s+public\.meetings/i)
    expect(migration).not.toMatch(/DELETE FROM\s+public\.meeting_audit_events/i)
    expect(migration).not.toMatch(/TRUNCATE\s+public\.meetings/i)
  })

  it('validates legacy participant rows and removes meeting_participants', () => {
    expect(migration).toContain('meeting_participants rows conflict with meetings')
    expect(migration).toContain('DROP TABLE IF EXISTS public.meeting_participants')
    expect(migration).not.toContain('CREATE TABLE public.meeting_participants')
  })

  it('rejects unsupported legacy role combinations before migrating data', () => {
    expect(migration).toContain('Unsupported legacy meeting participant combinations')
    expect(migration).toContain('meeting_calendar_validate_role_pair')
  })

  it('maps legacy REQUESTED and RESCHEDULING states to approved states', () => {
    expect(migration).toContain("WHEN m.current_state = 'REQUESTED'")
    expect(migration).toContain("WHEN m.current_state = 'RESCHEDULING' THEN 'CONFIRMED'")
    expect(migration).toContain('rescheduling_active = (m.current_state = \'RESCHEDULING\')')
    expect(migration).not.toMatch(/ADD CONSTRAINT meetings_state_valid CHECK[\s\S]*'REQUESTED'/)
    expect(migration).not.toMatch(/ADD CONSTRAINT meetings_state_valid CHECK[\s\S]*'RESCHEDULING'/)
  })

  it('migrates selected_slot_id into confirmed and pending slot columns', () => {
    expect(migration).toContain('confirmed_slot_id')
    expect(migration).toContain('pending_slot_id')
    expect(migration).toContain('DROP COLUMN IF EXISTS selected_slot_id')
    expect(migration).toContain('proposal_cycle')
  })

  it('fails safely when confirmed or rescheduling meetings cannot recover slots', () => {
    expect(migration).toContain('Confirmed meetings missing recoverable slot')
    expect(migration).toContain('RESCHEDULING meetings missing recoverable confirmed slot')
  })

  it('replaces institution-wide read access with participant-only RLS', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS meetings_select_authorized')
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.meeting_calendar_actor_can_read_meeting(UUID)')
    expect(migration).toContain('meetings_select_participants_only')
    expect(migration).not.toContain('auth_user_is_active_institution_manager_for_institution(m.institution_id)')
  })

  it('replaces legacy command functions with approved authorization', () => {
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.meeting_calendar_resolve_calendar_owner_id')
    expect(migration).toContain('Only the slot selector may confirm the meeting.')
    expect(migration).toContain('Only the calendar owner may cancel this meeting.')
    expect(migration).toContain('Only the calendar owner may initiate rescheduling.')
    expect(migration).toMatch(/meeting_calendar_confirm_meeting[\s\S]*FOR UPDATE/)
  })

  it('skips data migration when schema is already reconciled', () => {
    expect(migration).toContain('already reconciled; skipping data migration')
  })

  it('does not recreate auth_user_is_active_secretary_for_institution', () => {
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.auth_user_is_active_secretary_for_institution')
  })

  it('does not modify the original create migration file contents', () => {
    expect(originalMigration).toContain('CREATE TABLE public.meetings')
    expect(originalMigration).not.toContain('reconcile_meeting_calendar_phase1')
  })
})
