import type {
  CreateSubstituteBoardPostInput,
  SubstituteBoardPostStatus,
  SubstituteBoardPostType,
} from '../types/substituteBoard'

export const SUBSTITUTE_BOARD_POST_TYPE_OPTIONS: {
  value: SubstituteBoardPostType
  label: string
}[] = [
  { value: 'looking_for_substitute', label: 'אני מחפשת מילוי מקום' },
  { value: 'available_for_substitute', label: 'אני פנויה למילוי מקום' },
]

const postTypeLabels: Record<SubstituteBoardPostType, string> = {
  looking_for_substitute: 'מחפשת מילוי מקום',
  available_for_substitute: 'פנויה למילוי מקום',
}

const postStatusLabels: Record<SubstituteBoardPostStatus, string> = {
  open: 'פתוח',
  pending_secretary_approval: 'ממתין לאישור מזכירה',
  approved: 'אושר',
  cancelled: 'בוטל',
}

export function isSubstituteBoardPostType(
  value: string,
): value is SubstituteBoardPostType {
  return value === 'looking_for_substitute' || value === 'available_for_substitute'
}

export function isSubstituteBoardPostStatus(
  value: string,
): value is SubstituteBoardPostStatus {
  return (
    value === 'open' ||
    value === 'pending_secretary_approval' ||
    value === 'approved' ||
    value === 'cancelled'
  )
}

export function translateSubstituteBoardPostType(type: SubstituteBoardPostType): string {
  return postTypeLabels[type]
}

export function translateSubstituteBoardPostStatus(
  status: SubstituteBoardPostStatus,
): string {
  return postStatusLabels[status]
}

export function formatSubstituteBoardDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return isoDate
  }

  return date.toLocaleDateString('he-IL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatSubstituteBoardTime(timeValue: string | null): string {
  if (!timeValue) {
    return '—'
  }

  const [hours, minutes] = timeValue.split(':')
  if (!hours || !minutes) {
    return timeValue
  }

  return `${hours}:${minutes}`
}

export type ValidateCreateSubstituteBoardPostResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export function validateCreateSubstituteBoardPostInput(
  input: CreateSubstituteBoardPostInput,
): ValidateCreateSubstituteBoardPostResult {
  if (!isSubstituteBoardPostType(input.postType)) {
    return {
      ok: false,
      errorMessage: 'נא לבחור סוג פרסום.',
    }
  }

  if (!input.date) {
    return {
      ok: false,
      errorMessage: 'נא לבחור תאריך.',
    }
  }

  return { ok: true }
}

export function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeOptionalTime(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
