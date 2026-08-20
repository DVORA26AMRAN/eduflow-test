import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const J1 = 'supabase/migrations/20250819107000_management_journal_j1.sql'
const SERVICE = 'src/services/managementJournal.ts'
const SECTION = 'src/components/managementJournal/ManagementJournalSection.tsx'
const COMPOSER = 'src/components/managementJournal/ManagementJournalTaskComposer.tsx'
const ROW = 'src/components/managementJournal/ManagementJournalTaskRow.tsx'
const CSS = 'src/components/managementJournal/ManagementJournalSection.css'

const PHASE3_MARKERS = [
  'school_registration_quotation',
  'quotationPdf',
  'schoolRegistrationQuotation',
  'school-registration-quotation-pdf',
]

const FORBIDDEN_CALLS = [
  'management_journal_create_personal_page_for_date',
  'management_journal_create_shared_page_for_date',
  'management_journal_page_is_frozen',
  'management_journal_history_write',
  'management_journal_carry_into_page',
  "rpc('management_journal_can_assign'",
]

describe('J2B management journal task workflow contracts', () => {
  it('uses only the public task RPCs and never writes journal tables directly', () => {
    const service = read(SERVICE)
    expect(service).toContain("supabase.rpc('create_management_journal_task'")
    expect(service).toContain("supabase.rpc('update_management_journal_task_content'")
    expect(service).toContain("supabase.rpc('update_management_journal_task_note'")
    expect(service).toContain("supabase.rpc('assign_management_journal_task'")
    expect(service).toContain("supabase.rpc('update_management_journal_task_status'")
    expect(service).toContain('p_expected_status')
    expect(service).not.toMatch(/\.insert\(/)
    expect(service).not.toMatch(/\.update\(/)
    expect(service).not.toMatch(/\.delete\(/)

    for (const helper of FORBIDDEN_CALLS) {
      expect(service).not.toContain(helper)
      expect(read(SECTION)).not.toContain(helper)
    }
  })

  it('does not implement frontend carry-forward or client-selected initial status', () => {
    const frontend = [SERVICE, SECTION, COMPOSER, ROW].map(read).join('\n')
    expect(frontend).not.toContain('carry forward')
    expect(frontend).not.toContain('העברה ליום הבא')
    expect(frontend).not.toContain('p_status')
    expect(frontend).not.toContain('created_by_user_id:')
    expect(read(COMPOSER)).toContain('pageType === \'personal\' ? actorUserId')
  })

  it('keeps notebook layout without a table or horizontal overflow', () => {
    const css = read(CSS)
    expect(css).not.toContain('overflow-x: auto')
    expect(css).toContain('min-width: 0')
    expect(css).toContain('flex-wrap: wrap')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('flex-direction: column')
    expect(read(ROW)).not.toContain('<table')
    expect(read(SECTION)).not.toContain('<table')
  })

  it('leaves the J1 migration and Phase 3 quotation work untouched', () => {
    const j1 = read(J1)
    expect(j1).toContain('EduFlow J1 — Management Daily Journal database foundation')
    expect(read(SERVICE)).not.toContain('20250819107000')
    for (const source of [SERVICE, SECTION, COMPOSER, ROW, CSS]) {
      for (const marker of PHASE3_MARKERS) {
        expect(read(source)).not.toContain(marker)
      }
    }
  })

  it('freezes only on a newer same-stream page, not on a past date alone', () => {
    const display = read('src/utils/managementJournalDisplay.ts')
    const section = read(SECTION)
    const service = read(SERVICE)
    expect(display).not.toContain('pageJournalDate < currentJournalDate')
    expect(section).not.toContain('page.journalDate <')
    expect(section).not.toContain('journalDate <')
    expect(service).toContain(".eq('page_type', page.pageType)")
    expect(service).toContain(".eq('institution_id', page.institutionId)")
    expect(service).toContain(".gt('journal_date', page.journalDate)")
    expect(service).toContain("page.pageType === 'personal'")
    expect(service).toContain(".eq('owner_user_id', page.ownerUserId)")
  })

  it('keeps Secretary shared open on RLS SELECT and never grants shared create', () => {
    const section = read(SECTION)
    const display = read('src/utils/managementJournalDisplay.ts')
    expect(display).toContain('canCreateSharedManagementJournalPageUi')
    expect(display).toContain("role === 'institution_manager' || role === 'deputy'")
    expect(section).toContain('canCreateShared')
    expect(section).toContain('visibleSharedPageId')
    expect(section).toContain('loadTodayManagementJournalPage')
    expect(section).toMatch(/async function handleOpenSharedPage\(\) \{[\s\S]*?if \(!canCreateShared\) \{/)
  })
})
