import {
  SCHOOL_REGISTRATION_NOTE_MAX_LENGTH,
  type FollowUpUrgency,
  type SchoolRegistrationStatus,
  SCHOOL_REGISTRATION_STATUSES,
} from '../types/schoolRegistration'

export function isSchoolRegistrationStatus(
  value: unknown,
): value is SchoolRegistrationStatus {
  return (
    typeof value === 'string' &&
    (SCHOOL_REGISTRATION_STATUSES as string[]).includes(value)
  )
}

/** Calendar-day follow-up urgency in the viewer's local timezone. */
export function getFollowUpUrgency(
  followUpAt: string | null | undefined,
  now: Date = new Date(),
): FollowUpUrgency {
  if (!followUpAt) return 'none'
  const target = new Date(followUpAt)
  if (Number.isNaN(target.getTime())) return 'none'

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  if (target < startOfToday) return 'overdue'
  if (target < startOfTomorrow) return 'due_today'
  return 'future'
}

export function followUpUrgencyLabel(urgency: FollowUpUrgency): string {
  switch (urgency) {
    case 'overdue':
      return 'באיחור'
    case 'due_today':
      return 'היום'
    case 'future':
      return 'מתוזמן'
    default:
      return ''
  }
}

export function validateInternalNoteText(
  raw: string,
): { ok: true; noteText: string } | { ok: false; errorMessage: string } {
  const noteText = raw.trim()
  if (!noteText) {
    return { ok: false, errorMessage: 'לא ניתן לשמור הערה ריקה.' }
  }
  if (noteText.length > SCHOOL_REGISTRATION_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      errorMessage: `ההערה ארוכה מדי (עד ${SCHOOL_REGISTRATION_NOTE_MAX_LENGTH} תווים).`,
    }
  }
  return { ok: true, noteText }
}

/** Convert ISO timestamptz to value for <input type="datetime-local" />. */
export function toDateTimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Parse datetime-local value to ISO string, or null when cleared. */
export function fromDateTimeLocalValue(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}
