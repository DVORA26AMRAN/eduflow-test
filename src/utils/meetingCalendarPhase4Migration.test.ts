import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250719200000_meeting_calendar_phase4_lifecycle_notifications.sql',
)

describe('Phase 4 migration architecture guards', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('keeps reschedule propose/select on CONFIRMED instead of WAITING_* demotion', () => {
    expect(sql).toContain("v_is_reschedule := (v_meeting.current_state = 'CONFIRMED' AND v_meeting.rescheduling_active)")
    expect(sql).toContain("-- Overlay workflow: stay CONFIRMED; progress lives in slots + pending fields.")
    expect(sql).toMatch(/ELSIF v_is_reschedule THEN\s+v_next_state := 'CONFIRMED';/)

    // Must not reintroduce widened calendar reads that paper over WAITING_* demotion.
    expect(sql).not.toContain('OR m.rescheduling_active = TRUE')
    expect(sql).not.toContain("m.current_state NOT IN ('CANCELLED', 'COMPLETED')")
  })

  it('adds notification idempotency via source_audit_event_id unique index and EXISTS guard', () => {
    expect(sql).toContain('notifications_user_source_audit_event_uidx')
    expect(sql).toContain("metadata ->> 'source_audit_event_id'")
    expect(sql).toContain('p_source_audit_event_id')
    expect(sql).toContain('WHEN unique_violation THEN')
  })
})
