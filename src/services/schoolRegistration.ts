import type { SchoolRegistrationRecord } from '../types/schoolRegistration'
import {
  type SchoolRegistrationApplicantRole,
  type SchoolRegistrationStatus,
} from '../types/schoolRegistration'
import { validateSchoolRegistrationForm } from '../utils/schoolRegistrationForm'
import type { SchoolRegistrationFormFields } from '../types/schoolRegistration'
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase'

export type SubmitSchoolRegistrationResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type LoadSchoolRegistrationsResult =
  | { ok: true; registrations: SchoolRegistrationRecord[] }
  | { ok: false; errorMessage: string }

export type LoadSchoolRegistrationResult =
  | { ok: true; registration: SchoolRegistrationRecord }
  | { ok: false; errorMessage: string }

function parseApplicantRole(value: unknown): SchoolRegistrationApplicantRole | null {
  return value === 'principal' || value === 'vice_principal' ? value : null
}

function parseStatus(value: unknown): SchoolRegistrationStatus | null {
  if (
    value === 'new' ||
    value === 'contacted' ||
    value === 'in_review' ||
    value === 'converted' ||
    value === 'rejected'
  ) {
    return value
  }
  return null
}

function parseRegistrationRow(row: Record<string, unknown>): SchoolRegistrationRecord | null {
  const applicantRole = parseApplicantRole(row.applicant_role)
  const status = parseStatus(row.status)
  if (
    typeof row.id !== 'string' ||
    typeof row.school_name !== 'string' ||
    typeof row.institution_symbol !== 'string' ||
    typeof row.city !== 'string' ||
    !applicantRole ||
    typeof row.contact_full_name !== 'string' ||
    typeof row.email !== 'string' ||
    typeof row.phone !== 'string' ||
    !status ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    return null
  }

  return {
    id: row.id,
    schoolName: row.school_name,
    institutionSymbol: String(row.institution_symbol),
    city: row.city,
    applicantRole,
    contactFullName: row.contact_full_name,
    email: row.email,
    phone: row.phone,
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    convertedInstitutionId:
      typeof row.converted_institution_id === 'string'
        ? row.converted_institution_id
        : row.converted_institution_id === null
          ? null
          : undefined,
    convertedAt:
      typeof row.converted_at === 'string'
        ? row.converted_at
        : row.converted_at === null
          ? null
          : undefined,
  }
}

/** Public intake submit via constrained Edge Function (no institution/user creation). */
export async function submitSchoolRegistration(
  fields: SchoolRegistrationFormFields,
): Promise<SubmitSchoolRegistrationResult> {
  const validation = validateSchoolRegistrationForm(fields)
  if (!validation.ok) {
    return { ok: false, errorMessage: validation.errorMessage }
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/school-registration-intake`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify(validation.values),
      },
    )

    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean
      error?: string
    } | null

    if (!response.ok || !payload?.ok) {
      if (response.status === 429) {
        return {
          ok: false,
          errorMessage: 'נשלחו יותר מדי בקשות. נסו שוב מאוחר יותר.',
        }
      }
      if (response.status === 413) {
        return {
          ok: false,
          errorMessage: 'שליחת ההרשמה נכשלה. נסו שוב.',
        }
      }
      return {
        ok: false,
        errorMessage: 'שליחת ההרשמה נכשלה. נסו שוב.',
      }
    }

    return { ok: true }
  } catch {
    return {
      ok: false,
      errorMessage: 'שליחת ההרשמה נכשלה. נסו שוב.',
    }
  }
}

export async function loadSchoolRegistrationsForPlatformAdmin(): Promise<LoadSchoolRegistrationsResult> {
  const { data, error } = await supabase.rpc('platform_admin_list_school_registrations')

  if (error) {
    console.error('[schoolRegistration] list failed', error)
    return { ok: false, errorMessage: 'טעינת ההרשמות נכשלה.' }
  }

  const registrations = (Array.isArray(data) ? data : [])
    .map((row) => parseRegistrationRow(row as Record<string, unknown>))
    .filter((row): row is SchoolRegistrationRecord => row !== null)

  return { ok: true, registrations }
}

export async function loadSchoolRegistrationForPlatformAdmin(
  id: string,
): Promise<LoadSchoolRegistrationResult> {
  const { data, error } = await supabase.rpc('platform_admin_get_school_registration', {
    p_id: id,
  })

  if (error) {
    console.error('[schoolRegistration] get failed', error)
    return { ok: false, errorMessage: 'טעינת פרטי ההרשמה נכשלה.' }
  }

  const row = Array.isArray(data) ? data[0] : data
  const registration = row
    ? parseRegistrationRow(row as Record<string, unknown>)
    : null

  if (!registration) {
    return { ok: false, errorMessage: 'ההרשמה לא נמצאה.' }
  }

  return { ok: true, registration }
}
