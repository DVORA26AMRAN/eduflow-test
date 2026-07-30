import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20250730150000_institution_meeting_timezone.sql',
  ),
  'utf8',
)

describe('institution meeting timezone migration', () => {
  it('adds an institution timezone source of truth with a future-safe default', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS timezone TEXT')
    expect(migration).toContain("SET timezone = 'Asia/Jerusalem'")
    expect(migration).toContain("ALTER COLUMN timezone SET DEFAULT 'UTC'")
    expect(migration).toContain('ALTER COLUMN timezone SET NOT NULL')
  })

  it('backfills only UTC meetings for institutions marked as Israel timezone', () => {
    expect(migration).toContain('FROM public.institutions AS i')
    expect(migration).toContain('i.id = m.institution_id')
    expect(migration).toContain("i.timezone = 'Asia/Jerusalem'")
    expect(migration).toContain("m.institution_timezone = 'UTC'")
  })
})
