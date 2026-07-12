import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('requestReminders batch loading contract', () => {
  it('loads institution reminder summaries in a single query', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/services/requestReminders.ts'),
      'utf8',
    )

    expect(source).toContain('loadInstitutionRequestReminderSummaries')
    expect(source).toMatch(/from\('request_reminders'\)[\s\S]*?\.select\('request_id, reminder_number, created_at'\)/)

    const inboxSource = readFileSync(
      resolve(process.cwd(), 'src/components/secretary/SecretaryRequestsInbox.tsx'),
      'utf8',
    )

    expect(inboxSource).toContain('loadInstitutionRequestReminderSummaries()')
    expect(inboxSource).toContain('Promise.all')
    expect(inboxSource).not.toMatch(/requests\.map\([\s\S]*loadInstitutionRequestReminderSummaries/)
  })

  it('documents extended server-side status eligibility in migration', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20250712151000_extend_request_reminder_status_eligibility.sql',
      ),
      'utf8',
    )

    expect(migration).toContain("status NOT IN ('new', 'in_progress')")
    expect(migration).toContain("BEFORE: status = 'new'")
    expect(migration).toContain("AFTER:  status IN ('new', 'in_progress')")
  })
})
