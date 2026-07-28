import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250721120000_meeting_calendar_live_actions.sql',
)

describe('Live meeting actions migration guards', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('adds meeting format, connection details, and delay columns', () => {
    expect(sql).toContain("meeting_format TEXT NOT NULL DEFAULT 'in_person'")
    expect(sql).toContain('meet_url TEXT')
    expect(sql).toContain('phone_number TEXT')
    expect(sql).toContain('delay_minutes INTEGER')
    expect(sql).toContain("meeting_format IN ('online', 'phone', 'in_person')")
  })

  it('enforces participant and same-institution checks on live RPCs', () => {
    expect(sql).toContain('meeting_calendar_assert_actor_same_institution')
    expect(sql).toContain('meeting_calendar_get_live_context')
    expect(sql).toContain('meeting_calendar_report_delay')
    expect(sql).toContain('meeting_calendar_set_connection_details')
    expect(sql).toContain('meeting_calendar_record_live_primary_action')
    expect(sql).toContain("PERFORM public.meeting_calendar_assert_actor_same_institution(v_meeting)")
    expect(sql).toContain('INTERVAL \'15 minutes\'')
    expect(sql).toContain('INTERVAL \'30 minutes\'')
    expect(sql).toContain('Host-only Meet links are not allowed')
  })

  it('does not treat COMPLETED as an implemented live-actions terminal gate', () => {
    expect(sql).not.toContain("'COMPLETED'")
    expect(sql).toContain("v_meeting.current_state = 'CANCELLED'")
  })

  it('allows Meet query params and documents E.164 TODO', () => {
    expect(sql).toContain('TODO(E.164)')
    expect(sql).toContain('authuser, hs, pli')
  })

  it('audits live activity events and includes reporter display name on delay', () => {
    expect(sql).toContain('meeting_activity_events')
    expect(sql).toContain("'online_meeting_opened'")
    expect(sql).toContain("'phone_call_started'")
    expect(sql).toContain("'delay_reported'")
    expect(sql).toContain('reported_by_display_name')
    expect(sql).toContain('u.full_name')
  })

  it('rejects manual Meet URL entry and exposes system attach boundary', () => {
    expect(sql).toContain('Meet URL is system-managed and cannot be set manually')
    expect(sql).toContain('meeting_calendar_attach_system_meet_url')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.meeting_calendar_attach_system_meet_url')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.meeting_calendar_attach_system_meet_url(UUID, TEXT) FROM authenticated')
  })

  it('notifies on delay with MEETING_DELAY_REPORTED and replace semantics', () => {
    expect(sql).toContain("'MEETING_DELAY_REPORTED'")
    expect(sql).toContain('delay_minutes = p_delay_minutes')
    expect(sql).toContain('delay_report_key')
  })

  it('does not alter propose/select/confirm scheduling RPCs', () => {
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.meeting_calendar_propose_slots')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.meeting_calendar_select_slot')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.meeting_calendar_confirm_meeting')
  })
})
