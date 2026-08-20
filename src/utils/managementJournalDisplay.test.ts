import { describe, expect, it } from 'vitest'
import type { ManagementJournalCandidate } from '../types/managementJournal'
import {
  canAssignManagementJournalTask,
  canCreateManagementJournalTaskUi,
  canCreateSharedManagementJournalPageUi,
  canReassignManagementJournalTaskUi,
  canSelectSharedManagementJournalPage,
  filterAssignableJournalParticipants,
  filterEligibleJournalParticipantCandidates,
  formatManagementJournalHebrewDate,
  MANAGEMENT_JOURNAL_MESSAGES,
  MANAGEMENT_JOURNAL_STATUS_LABELS,
  isManagementJournalPageReadOnly,
  parseManagementJournalDateKey,
  sortManagementJournalTasks,
} from './managementJournalDisplay'

function candidate(
  overrides: Partial<ManagementJournalCandidate> & Pick<ManagementJournalCandidate, 'id' | 'fullName'>,
): ManagementJournalCandidate {
  return {
    primaryRole: 'secretary',
    status: 'active',
    institutionId: 'inst-1',
    ...overrides,
  }
}

describe('management journal display helpers', () => {
  it('formats the server date in Hebrew without using browser-local midnight', () => {
    expect(parseManagementJournalDateKey('2026-08-19')).toBe('2026-08-19')
    expect(parseManagementJournalDateKey('19/08/2026')).toBeNull()
    const formatted = formatManagementJournalHebrewDate('2026-08-19')
    expect(formatted).toMatch(/2026/)
    expect(formatted.length).toBeGreaterThan(8)
  })

  it('excludes inactive, other-institution, and non-management users from participant candidates', () => {
    const users: ManagementJournalCandidate[] = [
      candidate({ id: 'mgr', fullName: 'מנהלת', primaryRole: 'institution_manager' }),
      candidate({ id: 'dep', fullName: 'סגנית', primaryRole: 'deputy' }),
      candidate({ id: 'sec', fullName: 'מזכירה', primaryRole: 'secretary' }),
      candidate({ id: 'inactive', fullName: 'לא פעילה', status: 'inactive' }),
      candidate({ id: 'other-school', fullName: 'אחר', institutionId: 'inst-2' }),
    ]

    const eligible = filterEligibleJournalParticipantCandidates(users, 'inst-1')
    expect(eligible.map((row) => row.id)).toEqual(['mgr', 'dep', 'sec'])
  })

  it('hides shared-page CREATE from secretary while still allowing open when participant-visible', () => {
    expect(canCreateSharedManagementJournalPageUi('institution_manager')).toBe(true)
    expect(canCreateSharedManagementJournalPageUi('deputy')).toBe(true)
    expect(canCreateSharedManagementJournalPageUi('secretary')).toBe(false)
    expect(canSelectSharedManagementJournalPage('secretary')).toBe(false)
  })

  it('hides shared task create/reassign UI for secretary only', () => {
    expect(canCreateManagementJournalTaskUi('secretary', 'shared')).toBe(false)
    expect(canReassignManagementJournalTaskUi('secretary', 'shared')).toBe(false)
    expect(canCreateManagementJournalTaskUi('secretary', 'personal')).toBe(true)
    expect(canReassignManagementJournalTaskUi('secretary', 'personal')).toBe(false)
    expect(canCreateManagementJournalTaskUi('institution_manager', 'shared')).toBe(true)
    expect(canCreateManagementJournalTaskUi('deputy', 'shared')).toBe(true)
    expect(canReassignManagementJournalTaskUi('institution_manager', 'shared')).toBe(true)
    expect(canReassignManagementJournalTaskUi('deputy', 'shared')).toBe(true)
  })

  it('keeps journal_page_exists copy from leaking page or participant data', () => {
    expect(MANAGEMENT_JOURNAL_MESSAGES.JOURNAL_PAGE_EXISTS).toBe('לא ניתן לפתוח את הדף המשותף להיום.')
    expect(MANAGEMENT_JOURNAL_MESSAGES.JOURNAL_PAGE_EXISTS).not.toMatch(/משתתפ/)
    expect(MANAGEMENT_JOURNAL_MESSAGES.JOURNAL_PAGE_EXISTS).not.toMatch(/page_id/)
  })

  it('maps Hebrew task statuses exactly', () => {
    expect(MANAGEMENT_JOURNAL_STATUS_LABELS).toEqual({
      new: 'חדש',
      in_progress: 'בטיפול',
      completed: 'הושלם',
      blocked: 'חסום',
    })
  })

  it('follows the J1 assignment matrix for manager, deputy, and secretary', () => {
    expect(canAssignManagementJournalTask('institution_manager', 'mgr', 'institution_manager', 'mgr')).toBe(true)
    expect(canAssignManagementJournalTask('institution_manager', 'mgr', 'deputy', 'dep')).toBe(true)
    expect(canAssignManagementJournalTask('institution_manager', 'mgr', 'secretary', 'sec')).toBe(true)
    expect(canAssignManagementJournalTask('institution_manager', 'mgr', 'institution_manager', 'other-mgr')).toBe(
      false,
    )
    expect(canAssignManagementJournalTask('deputy', 'dep', 'deputy', 'dep')).toBe(true)
    expect(canAssignManagementJournalTask('deputy', 'dep', 'secretary', 'sec')).toBe(true)
    expect(canAssignManagementJournalTask('deputy', 'dep', 'institution_manager', 'mgr')).toBe(false)
    expect(canAssignManagementJournalTask('secretary', 'sec', 'secretary', 'sec')).toBe(true)
    expect(canAssignManagementJournalTask('secretary', 'sec', 'secretary', 'other-sec')).toBe(false)
    expect(canAssignManagementJournalTask('secretary', 'sec', 'deputy', 'dep')).toBe(false)
  })

  it('excludes inactive and non-participants from assignment options', () => {
    const options = filterAssignableJournalParticipants('institution_manager', 'mgr', [
      {
        pageId: 'p',
        userId: 'mgr',
        addedByUserId: null,
        addedAutomatically: true,
        addedAt: '',
        fullName: 'מנהלת',
        primaryRole: 'institution_manager',
        status: 'active',
      },
      {
        pageId: 'p',
        userId: 'sec',
        addedByUserId: null,
        addedAutomatically: false,
        addedAt: '',
        fullName: 'מזכירה',
        primaryRole: 'secretary',
        status: 'inactive',
      },
    ])
    expect(options.map((row) => row.userId)).toEqual(['mgr'])
  })

  it('sorts tasks by persisted sort_order only', () => {
    expect(sortManagementJournalTasks([{ sortOrder: 3 }, { sortOrder: 1 }, { sortOrder: 2 }]).map((row) => row.sortOrder)).toEqual(
      [1, 2, 3],
    )
  })

  it('freezes a page only when a newer same-stream page exists, not because the date is in the past', () => {
    expect(isManagementJournalPageReadOnly(false)).toBe(false)
    expect(isManagementJournalPageReadOnly(true)).toBe(true)
  })
})
