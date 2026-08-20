import type { PrimaryRole } from '../types/user'
import type {
  ManagementJournalCandidate,
  ManagementJournalErrorCode,
  ManagementJournalPageType,
  ManagementJournalParticipant,
  ManagementJournalRole,
  ManagementJournalTaskStatus,
} from '../types/managementJournal'

export const MANAGEMENT_JOURNAL_SECTION_ID = 'managementJournal'
export const MANAGEMENT_JOURNAL_NAV_LABEL = 'יומן ניהול'
export const MANAGEMENT_JOURNAL_TIME_ZONE = 'Asia/Jerusalem'
export const MANAGEMENT_JOURNAL_EMPTY_TASKS_LABEL = 'אין עדיין משימות בדף זה'
export const MANAGEMENT_JOURNAL_ADD_TASK_LABEL = 'הוספת משימה'
export const MANAGEMENT_JOURNAL_CARRIED_LABEL = 'הועבר מיום קודם'
export const MANAGEMENT_JOURNAL_UNASSIGNED_LABEL =
  'ללא אחראית — האחראית הקודמת אינה פעילה'
export const MANAGEMENT_JOURNAL_FROZEN_LABEL = 'דף זה נשמר בהיסטוריה ואינו ניתן לעריכה.'
export const MANAGEMENT_JOURNAL_STALE_STATUS_LABEL = 'המשימה עודכנה במקום אחר. הנתונים רועננו.'
export const MANAGEMENT_JOURNAL_NOTE_LABEL = 'הערת טיפול'

export const MANAGEMENT_JOURNAL_ROLES: readonly ManagementJournalRole[] = [
  'institution_manager',
  'deputy',
  'secretary',
]

export const MANAGEMENT_JOURNAL_MESSAGES: Record<ManagementJournalErrorCode, string> = {
  PERMISSION_DENIED: 'אין הרשאה לבצע פעולה זו ביומן הניהול.',
  JOURNAL_PAGE_EXISTS: 'לא ניתן לפתוח את הדף המשותף להיום.',
  JOURNAL_PAGE_FROZEN: MANAGEMENT_JOURNAL_FROZEN_LABEL,
  JOURNAL_STALE_STATUS: MANAGEMENT_JOURNAL_STALE_STATUS_LABEL,
  JOURNAL_INVALID_ARGUMENT: 'לא ניתן לשמור את המשימה. בדקו את הפרטים.',
  INACTIVE_PROFILE: 'הפרופיל אינו פעיל. לא ניתן להשתמש ביומן הניהול.',
  NETWORK: 'לא ניתן להתחבר ליומן הניהול כרגע.',
  UNKNOWN: 'לא ניתן להשלים את הפעולה ביומן הניהול.',
}

export const MANAGEMENT_JOURNAL_STATUS_LABELS: Record<ManagementJournalTaskStatus, string> = {
  new: 'חדש',
  in_progress: 'בטיפול',
  completed: 'הושלם',
  blocked: 'חסום',
}

const PAGE_TYPE_LABELS: Record<ManagementJournalPageType, string> = {
  personal: 'דף אישי',
  shared: 'דף משותף',
}

export function isManagementJournalPageType(value: unknown): value is ManagementJournalPageType {
  return value === 'personal' || value === 'shared'
}

export function isManagementJournalTaskStatus(value: unknown): value is ManagementJournalTaskStatus {
  return value === 'new' || value === 'in_progress' || value === 'completed' || value === 'blocked'
}

export function isManagementJournalRole(value: unknown): value is ManagementJournalRole {
  return value === 'institution_manager' || value === 'deputy' || value === 'secretary'
}

export function canUseManagementJournalUi(role: PrimaryRole | null | undefined): boolean {
  return isManagementJournalRole(role)
}

/**
 * UI-only: Manager/Deputy may create/open shared pages via the create RPC.
 * Secretary must never receive shared-page CREATE controls.
 */
export function canCreateSharedManagementJournalPageUi(
  role: PrimaryRole | null | undefined,
): boolean {
  return role === 'institution_manager' || role === 'deputy'
}

/**
 * @deprecated Prefer canCreateSharedManagementJournalPageUi. Kept for call-site clarity:
 * "select" historically meant create/open for operators only.
 */
export function canSelectSharedManagementJournalPage(role: PrimaryRole | null | undefined): boolean {
  return canCreateSharedManagementJournalPageUi(role)
}

export function canAddManagementJournalParticipantUi(role: PrimaryRole | null | undefined): boolean {
  return role === 'institution_manager' || role === 'deputy'
}

/**
 * UI-only: Secretary must not create tasks on shared pages (DB denies).
 * Personal pages keep owner create for all management roles.
 */
export function canCreateManagementJournalTaskUi(
  role: PrimaryRole | null | undefined,
  pageType: ManagementJournalPageType | null | undefined,
): boolean {
  if (!isManagementJournalRole(role) || !pageType) {
    return false
  }
  if (pageType === 'shared' && role === 'secretary') {
    return false
  }
  return true
}

/**
 * UI-only: Secretary must not assign/reassign on shared pages (DB denies).
 * Does not change the display copy of management_journal_can_assign.
 */
export function canReassignManagementJournalTaskUi(
  role: PrimaryRole | null | undefined,
  pageType: ManagementJournalPageType | null | undefined,
): boolean {
  if (!isManagementJournalRole(role) || pageType !== 'shared') {
    return false
  }
  if (role === 'secretary') {
    return false
  }
  return true
}

export function translateManagementJournalPageType(pageType: ManagementJournalPageType): string {
  return PAGE_TYPE_LABELS[pageType]
}

export function translateManagementJournalTaskStatus(status: ManagementJournalTaskStatus): string {
  return MANAGEMENT_JOURNAL_STATUS_LABELS[status]
}

export function formatManagementJournalTargetTime(value: string | null): string | null {
  if (!value) {
    return null
  }
  return value.slice(0, 5)
}

/**
 * Display-only freeze: a page is frozen only when a newer page exists in the
 * same journal stream. A past journal_date alone is not frozen.
 */
export function isManagementJournalPageReadOnly(newerSameStreamPageExists: boolean): boolean {
  return newerSameStreamPageExists === true
}

/**
 * Display-only copy of J1 management_journal_can_assign. Database remains authoritative.
 */
export function canAssignManagementJournalTask(
  actorRole: PrimaryRole | null | undefined,
  actorUserId: string,
  targetRole: ManagementJournalRole | null | undefined,
  targetUserId: string,
): boolean {
  if (!actorUserId || !targetUserId || !isManagementJournalRole(actorRole) || !targetRole) {
    return false
  }

  if (actorRole === 'institution_manager') {
    if (targetUserId === actorUserId) {
      return true
    }
    return targetRole === 'deputy' || targetRole === 'secretary'
  }

  if (actorRole === 'deputy') {
    if (targetUserId === actorUserId) {
      return true
    }
    return targetRole === 'secretary'
  }

  return targetUserId === actorUserId && targetRole === 'secretary'
}

export function filterAssignableJournalParticipants(
  actorRole: PrimaryRole | null | undefined,
  actorUserId: string,
  participants: ManagementJournalParticipant[],
): ManagementJournalParticipant[] {
  return participants.filter((participant) => {
    if (participant.status !== 'active') {
      return false
    }
    return canAssignManagementJournalTask(
      actorRole,
      actorUserId,
      participant.primaryRole,
      participant.userId,
    )
  })
}

export function sortManagementJournalTasks<T extends { sortOrder: number }>(tasks: T[]): T[] {
  return [...tasks].sort((left, right) => left.sortOrder - right.sortOrder)
}

export function parseManagementJournalDateKey(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }
  return value
}

export function formatManagementJournalHebrewDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: MANAGEMENT_JOURNAL_TIME_ZONE,
  }).format(utcNoon)
}

export function filterEligibleJournalParticipantCandidates(
  users: ManagementJournalCandidate[],
  institutionId: string,
): ManagementJournalCandidate[] {
  return users.filter((user) => {
    if (user.institutionId !== institutionId) {
      return false
    }
    if (user.status !== 'active') {
      return false
    }
    return isManagementJournalRole(user.primaryRole)
  })
}
