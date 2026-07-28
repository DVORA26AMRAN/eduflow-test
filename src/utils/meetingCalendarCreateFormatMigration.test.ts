import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250728150000_meeting_calendar_create_meeting_format.sql',
)

describe('Create meeting format migration guards', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('requires meeting_format and phone number for phone meetings', () => {
    expect(sql).toContain('p_meeting_format TEXT')
    expect(sql).toContain('p_phone_number TEXT')
    expect(sql).toContain('Meeting format is required.')
    expect(sql).toContain('Phone number is required for phone meetings.')
  })

  it('rejects manual Meet URL at creation and leaves meet_url NULL', () => {
    expect(sql).toContain('Meet URL is system-managed and cannot be set manually.')
    expect(sql).toContain('p_meet_url TEXT DEFAULT NULL')
    expect(sql).toContain('meet_url')
  })

  it('persists meeting_format on insert', () => {
    expect(sql).toContain('meeting_format,')
    expect(sql).toContain('v_format,')
  })
})
