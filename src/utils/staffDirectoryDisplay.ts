import type { StaffDirectoryMember } from '../types/staffDirectory'

export const STAFF_DIRECTORY_SECTION_ID = 'staffDirectory'
export const STAFF_DIRECTORY_NAV_LABEL = 'פרטי צוות'

export const STAFF_DIRECTORY_LOADING_MESSAGE = 'טוען פרטי צוות...'
export const STAFF_DIRECTORY_EMPTY_MESSAGE = 'לא נמצאו אנשי צוות.'
export const STAFF_DIRECTORY_ERROR_MESSAGE = 'טעינת פרטי הצוות נכשלה.'
export const STAFF_MEMBER_DETAILS_LOADING_MESSAGE = 'טוען פרטי עובד...'

export type StaffDirectorySortKey = 'fullName' | 'jobTitle' | 'weeklyHours'
export type StaffDirectorySortDirection = 'asc' | 'desc'

export function translateStaffMemberStatus(status: string): string {
  if (status === 'active') {
    return 'פעיל'
  }
  if (status === 'inactive') {
    return 'לא פעיל'
  }
  return status
}

export function formatStaffJobTitle(jobTitle: string | null): string {
  return jobTitle?.trim() || 'מורה'
}

export function formatWeeklyHours(hours: number | null): string {
  if (hours === null) {
    return '—'
  }
  return Number.isInteger(hours) ? String(hours) : hours.toLocaleString('he-IL')
}

export function formatStaffJoinDate(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

export function filterStaffDirectoryMembers(
  members: StaffDirectoryMember[],
  query: string,
): StaffDirectoryMember[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return members
  }

  return members.filter((member) => {
    const haystack = [member.fullName, member.email, member.phone ?? '']
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })
}

function compareNullableText(
  left: string | null,
  right: string | null,
  direction: StaffDirectorySortDirection,
): number {
  const leftValue = (left ?? '').trim().toLocaleLowerCase('he')
  const rightValue = (right ?? '').trim().toLocaleLowerCase('he')
  const result = leftValue.localeCompare(rightValue, 'he')
  return direction === 'asc' ? result : -result
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: StaffDirectorySortDirection,
): number {
  if (left === null && right === null) {
    return 0
  }
  if (left === null) {
    return 1
  }
  if (right === null) {
    return -1
  }
  const result = left - right
  return direction === 'asc' ? result : -result
}

export function sortStaffDirectoryMembers(
  members: StaffDirectoryMember[],
  sortKey: StaffDirectorySortKey,
  direction: StaffDirectorySortDirection,
): StaffDirectoryMember[] {
  const sorted = [...members]

  sorted.sort((left, right) => {
    switch (sortKey) {
      case 'fullName':
        return compareNullableText(left.fullName, right.fullName, direction)
      case 'jobTitle':
        return compareNullableText(left.jobTitle, right.jobTitle, direction)
      case 'weeklyHours':
        return compareNullableNumber(left.weeklyHours, right.weeklyHours, direction)
      default:
        return 0
    }
  })

  return sorted
}
