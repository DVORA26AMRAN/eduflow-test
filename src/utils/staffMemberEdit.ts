import type { UpdateStaffMemberInput } from '../types/staffDirectory'

export type StaffMemberEditFields = {
  fullName: string
  phone: string
  jobTitle: string
  weeklyHours: string
  nationalId: string
}

export type StaffMemberEditValidationResult =
  | { ok: true; values: Omit<UpdateStaffMemberInput, 'userId'> }
  | { ok: false; errorMessage: string }

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function validateStaffMemberEdit(
  fields: StaffMemberEditFields,
): StaffMemberEditValidationResult {
  const fullName = fields.fullName.trim()

  if (!fullName) {
    return { ok: false, errorMessage: 'שם מלא הוא שדה חובה.' }
  }

  const weeklyHoursText = fields.weeklyHours.trim().replace(',', '.')
  let weeklyHours: number | null = null

  if (weeklyHoursText !== '') {
    const parsed = Number(weeklyHoursText)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, errorMessage: 'היקף משרה חייב להיות מספר גדול מאפס.' }
    }
    weeklyHours = parsed
  }

  return {
    ok: true,
    values: {
      fullName,
      phone: normalizeOptionalText(fields.phone),
      jobTitle: normalizeOptionalText(fields.jobTitle),
      weeklyHours,
      nationalId: normalizeOptionalText(fields.nationalId),
    },
  }
}
