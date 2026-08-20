import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MANAGEMENT_JOURNAL_NAV_LABEL,
  MANAGEMENT_JOURNAL_SECTION_ID,
} from './managementJournalDisplay'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const J1 = 'supabase/migrations/20250819107000_management_journal_j1.sql'
const SERVICE = 'src/services/managementJournal.ts'
const SECTION = 'src/components/managementJournal/ManagementJournalSection.tsx'
const CSS = 'src/components/managementJournal/ManagementJournalSection.css'
const TYPES = 'src/types/managementJournal.ts'
const DISPLAY = 'src/utils/managementJournalDisplay.ts'
const MANAGER = 'src/pages/ManagerDashboardPage.tsx'
const SECRETARY = 'src/pages/SecretaryDashboardPage.tsx'
const TEACHER = 'src/pages/TeacherDashboardPage.tsx'
const PLATFORM = 'src/pages/PlatformAdminDashboardPage.tsx'

const PHASE3_MARKERS = [
  'school_registration_quotation',
  'quotationPdf',
  'schoolRegistrationQuotation',
  'school-registration-quotation-pdf',
]

const PRIVATE_HELPERS = [
  'management_journal_create_personal_page_for_date',
  'management_journal_create_shared_page_for_date',
  'management_journal_lock_validate_target_user',
  'auth_user_can_read_management_journal_page',
]

const JOURNAL_FRONTEND = [SERVICE, SECTION, TYPES, DISPLAY, CSS]

describe('J2A management journal UI shell contracts', () => {
  it('keeps Hebrew nav constants and wires manager plus secretary dashboards only', () => {
    expect(MANAGEMENT_JOURNAL_NAV_LABEL).toBe('יומן ניהול')
    expect(MANAGEMENT_JOURNAL_SECTION_ID).toBe('managementJournal')

    const manager = read(MANAGER)
    const secretary = read(SECRETARY)
    const teacher = read(TEACHER)
    const platform = read(PLATFORM)

    expect(manager).toContain('MANAGEMENT_JOURNAL_SECTION_ID')
    expect(manager).toContain('ManagementJournalSection')
    expect(manager).toContain('canUseManagementJournal')
    expect(secretary).toContain('MANAGEMENT_JOURNAL_SECTION_ID')
    expect(secretary).toContain('ManagementJournalSection')

    expect(teacher).not.toContain('MANAGEMENT_JOURNAL_SECTION_ID')
    expect(teacher).not.toContain('ManagementJournalSection')
    expect(teacher).not.toContain('יומן ניהול')
    expect(platform).not.toContain('MANAGEMENT_JOURNAL_SECTION_ID')
    expect(platform).not.toContain('ManagementJournalSection')
    expect(platform).not.toContain('יומן ניהול')
  })

  it('does not create a second application shell', () => {
    const section = read(SECTION)
    expect(section).not.toContain('DashboardShell')
    expect(section).toContain('DashboardSection')
    expect(read(MANAGER)).toContain('<DashboardShell')
    expect(read(SECRETARY)).toContain('<DashboardShell')
  })

  it('uses public J1 RPCs and never sends a client journal date', () => {
    const service = read(SERVICE)
    expect(service).toContain("supabase.rpc('management_journal_current_date')")
    expect(service).toContain("supabase.rpc('create_management_journal_personal_page')")
    expect(service).toContain("supabase.rpc('create_management_journal_shared_page'")
    expect(service).toContain("p_participant_user_ids:")
    expect(service).toContain("supabase.rpc('add_management_journal_page_participant'")
    expect(service).toContain('p_page_id: pageId')
    expect(service).toContain('p_user_id: userId')
    expect(service).not.toContain('p_journal_date')
    expect(service).not.toMatch(/rpc\('create_management_journal_personal_page',\s*\{/)
    expect(service).toContain("USERS_JOURNAL_SELECT = 'id, full_name, primary_role, status, institution_id'")

    for (const helper of PRIVATE_HELPERS) {
      expect(service).not.toContain(helper)
      expect(read(SECTION)).not.toContain(helper)
    }
  })

  it('does not write journal tables from the frontend and keeps users ACL columns', () => {
    const service = read(SERVICE)
    expect(service).not.toMatch(/\.insert\(/)
    expect(service).not.toMatch(/\.update\(/)
    expect(service).not.toMatch(/\.delete\(/)
    expect(service).not.toContain('national_id')
    expect(service).toContain(".from('management_journal_pages')")
    expect(service).toContain(".from('management_journal_page_participants')")
    expect(service).toContain(".from('management_journal_tasks')")
  })

  it('keeps J1 status values and page types exact', () => {
    const types = read(TYPES)
    expect(types).toContain("'personal' | 'shared'")
    expect(types).toContain("'new' | 'in_progress' | 'completed' | 'blocked'")
  })

  it('personal UI has no participant selector and shared membership is append-only', () => {
    const section = read(SECTION)
    expect(section).toContain('דף אישי')
    expect(section).toContain('דף משותף')
    expect(section).toContain('canCreateSharedManagementJournalPageUi')
    expect(section).toContain('journal-shared-participant-selector')
    expect(section).toContain('disabled')
    expect(section).not.toContain('הסרה')
    expect(section).not.toContain('הסר משתתף')
    expect(section).not.toContain('removeParticipant')
    expect(section).toContain('MANAGEMENT_JOURNAL_EMPTY_TASKS_LABEL')
    expect(section).toContain('JOURNAL_PAGE_EXISTS')
    expect(section).toContain('journal-page-exists-denial')
  })

  it('never uses shared create RPC as a discovery path for Secretary', () => {
    const section = read(SECTION)
    expect(section).toContain('loadTodayManagementJournalPage')
    expect(section).toContain('visibleSharedPageId')
    expect(section).toContain('if (!canCreateShared)')
    expect(section).toMatch(/async function handleOpenSharedPage\(\) \{[\s\S]*?if \(!canCreateShared\) \{/)
  })

  it('uses CSS ruled lines and a mobile-width notebook contract', () => {
    const css = read(CSS)
    expect(css).toContain('repeating-linear-gradient')
    expect(css).not.toMatch(/url\(/)
    expect(css).toContain('max-width: 100%')
    expect(css).toContain('min-width: 0')
    expect(css).toContain('flex-wrap: wrap')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('@media (max-width: 1024px)')
    expect(css).toContain('.management-journal__paper')
    expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]*max-width:\s*100%/)
  })

  it('leaves the J1 migration untouched and does not add new migrations', () => {
    const j1 = read(J1)
    expect(j1).toContain('EduFlow J1 — Management Daily Journal database foundation')
    expect(j1).toContain('create_management_journal_personal_page()')
    expect(read(SERVICE)).not.toContain('20250819107000')
    expect(read(SECTION)).not.toContain('CREATE TABLE')
  })

  it('does not touch Phase 3 quotation/PDF work', () => {
    for (const path of JOURNAL_FRONTEND) {
      const source = read(path)
      for (const marker of PHASE3_MARKERS) {
        expect(source).not.toContain(marker)
      }
    }
    expect(read(MANAGER)).not.toMatch(/schoolRegistrationQuotation/)
  })
})
