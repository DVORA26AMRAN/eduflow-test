import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250719100000_meeting_calendar_phase3_range_reads.sql',
)

describe('meeting calendar Phase 3 range-read migration', () => {
  const migration = readFileSync(migrationPath, 'utf8')

  it('creates participant-scoped confirmed range and upcoming RPCs', () => {
    expect(migration).toContain('meeting_calendar_list_confirmed_in_range')
    expect(migration).toContain('meeting_calendar_list_upcoming_confirmed')
    expect(migration).toContain('s.starts_at < p_range_end')
    expect(migration).toContain('s.ends_at > p_range_start')
    expect(migration).toContain('s.starts_at >= p_from')
    expect(migration).toContain('LIMIT v_limit')
  })

  it('creates a pending-only list RPC without confirmed history', () => {
    expect(migration).toContain('meeting_calendar_list_pending_meetings')
    expect(migration).toContain("'WAITING_FOR_OWNER_APPROVAL'")
    expect(migration).toContain("'WAITING_FOR_FINAL_CONFIRMATION'")
    expect(migration).not.toMatch(
      /meeting_calendar_list_pending_meetings[\s\S]*current_state = 'CONFIRMED'/,
    )
  })

  it('locks down execute grants and uses security definer', () => {
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain('SET search_path = public')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.meeting_calendar_list_confirmed_in_range')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.meeting_calendar_list_pending_meetings')
  })
})
