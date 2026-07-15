import type { UserRole } from '../types/user'

export type CreateUserFormFields = {
  fullName: string
  email: string
  role: UserRole
  phone: string
  nationalId: string
  jobTitle: string
  weeklyHours: string
}

export type ValidatedCreateUserFields = {
  fullName: string
  email: string
  role: UserRole
  phone: string | null
  nationalId: string | null
  jobTitle: string | null
  weeklyHours: number | null
}

export type CreateUserFormValidationResult =
  | { ok: true; values: ValidatedCreateUserFields }
  | { ok: false; errorMessage: string }

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function parseOptionalPositiveWeeklyHours(
  raw: string,
): { ok: true; value: number | null } | { ok: false; errorMessage: string } {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: true, value: null }
  }

  const normalized = trimmed.replace(',', '.')
  const parsed = Number(normalized)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, errorMessage: 'שעות שבועיות חייבות להיות מספר חיובי.' }
  }

  return { ok: true, value: parsed }
}

export function validateCreateUserForm(
  fields: CreateUserFormFields,
): CreateUserFormValidationResult {
  const fullName = fields.fullName.trim()
  const email = fields.email.trim()

  if (!fullName || !email) {
    return { ok: false, errorMessage: 'נא למלא שם מלא וכתובת מייל.' }
  }

  const weeklyHoursResult = parseOptionalPositiveWeeklyHours(fields.weeklyHours)
  if (!weeklyHoursResult.ok) {
    return weeklyHoursResult
  }

  return {
    ok: true,
    values: {
      fullName,
      email,
      role: fields.role,
      phone: normalizeOptionalText(fields.phone),
      nationalId: normalizeOptionalText(fields.nationalId),
      jobTitle: normalizeOptionalText(fields.jobTitle),
      weeklyHours: weeklyHoursResult.value,
    },
  }
}
