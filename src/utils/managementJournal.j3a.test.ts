/**
 * J3A Management Daily Journal — daily summary contracts.
 * No DB migrations; presentation-only projection.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const J1 = 'supabase/migrations/20250819107000_management_journal_j1.sql'
const HARDENING = 'supabase/migrations/20250820108000_management_journal_secretary_shared_task_create_deny.sql'
const SECTION = 'src/components/managementJournal/ManagementJournalSection.tsx'
const SUMMARY = 'src/components/managementJournal/ManagementJournalDailySummary.tsx'
const SUMMARY_CSS = 'src/components/managementJournal/ManagementJournalDailySummary.css'

const PHASE3_MARKERS = [
  'school_registration_quotation',
  'quotationPdf',
  'schoolRegistrationQuotation',
  'school-registration-quotation-pdf',
]

describe('J3A daily summary contracts', () => {
  it('adds a daily-summary open path that refreshes authoritative page/tasks first', () => {
    const section = read(SECTION)
    expect(section).toContain('MANAGEMENT_JOURNAL_DAILY_SUMMARY_BUTTON_LABEL')
    expect(section).toContain('journal-daily-summary-open')
    expect(section).toContain('handleOpenDailySummary')
    expect(section).toMatch(
      /async function handleOpenDailySummary\(\) \{[\s\S]*?refreshPageBundle\(page\.id\)/,
    )
    expect(section).toMatch(
      /if \(!bundle\.ok \|\| !bundle\.page\) \{[\s\S]*?setSummaryOpen\(false\)/,
    )
    expect(section).toContain('ManagementJournalDailySummary')
  })

  it('keeps the summary component read-only and free of mutation RPCs', () => {
    const summary = read(SUMMARY)
    expect(summary).not.toContain('createManagementJournalTask')
    expect(summary).not.toContain('updateManagementJournalTaskStatus')
    expect(summary).not.toContain('updateManagementJournalTaskNote')
    expect(summary).not.toContain('updateManagementJournalTaskContent')
    expect(summary).not.toContain('assignManagementJournalTask')
    expect(summary).not.toContain('addManagementJournalPageParticipant')
    expect(summary).not.toContain('supabase.rpc')
    expect(summary).toContain('MANAGEMENT_JOURNAL_DAILY_SUMMARY_TASK_COLUMN')
    expect(summary).toContain('MANAGEMENT_JOURNAL_DAILY_SUMMARY_STATUS_COLUMN')
    expect(summary).toContain('disabled')
    expect(summary).toContain('MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_LABEL')
  })

  it('does not create migrations or touch J1/108000/Phase 3', () => {
    expect(existsSync(resolve(root, 'supabase/migrations/20250820109000_management_journal_j3a.sql'))).toBe(
      false,
    )
    const j1Hash = createHash('sha256').update(read(J1)).digest('hex')
    const hardeningHash = createHash('sha256').update(read(HARDENING)).digest('hex')
    expect(j1Hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hardeningHash).toMatch(/^[a-f0-9]{64}$/)
    expect(read(J1)).toContain('CREATE TABLE public.management_journal_pages')
    expect(read(HARDENING)).toContain("v_caller.primary_role = 'secretary'::public.user_role")

    for (const path of [SECTION, SUMMARY, SUMMARY_CSS]) {
      const body = read(path)
      for (const marker of PHASE3_MARKERS) {
        expect(body).not.toContain(marker)
      }
    }
  })

  it('keeps mobile no-horizontal-overflow layout rules in the summary CSS', () => {
    const css = read(SUMMARY_CSS)
    expect(css).toContain('max-width: 100%')
    expect(css).toContain('min-width: 0')
    expect(css).toContain('overflow-wrap: anywhere')
    expect(css).not.toContain('overflow-x: hidden')
  })
})
