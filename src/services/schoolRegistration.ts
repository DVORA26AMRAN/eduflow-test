import type {
  SchoolRegistrationActivity,
  SchoolRegistrationActivityEventType,
  SchoolRegistrationFormFields,
  SchoolRegistrationNote,
  SchoolRegistrationRecord,
  SchoolRegistrationApplicantRole,
  SchoolRegistrationStatus,
} from '../types/schoolRegistration'
import { validateSchoolRegistrationForm } from '../utils/schoolRegistrationForm'
import { isSchoolRegistrationStatus, validateInternalNoteText } from '../utils/schoolRegistrationSales'
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

export type MutationResult = { ok: true } | { ok: false; errorMessage: string }

export type LoadNotesResult =
  | { ok: true; notes: SchoolRegistrationNote[] }
  | { ok: false; errorMessage: string }

export type LoadActivityResult =
  | { ok: true; activities: SchoolRegistrationActivity[] }
  | { ok: false; errorMessage: string }

function parseApplicantRole(value: unknown): SchoolRegistrationApplicantRole | null {
  return value === 'principal' || value === 'vice_principal' ? value : null
}

function parseStatus(value: unknown): SchoolRegistrationStatus | null {
  return isSchoolRegistrationStatus(value) ? value : null
}

function parseActivityEventType(
  value: unknown,
): SchoolRegistrationActivityEventType | null {
  if (
    value === 'registration_created' ||
    value === 'note_added' ||
    value === 'status_changed' ||
    value === 'follow_up_set' ||
    value === 'follow_up_rescheduled' ||
    value === 'follow_up_cleared'
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

  const followUpAt =
    typeof row.follow_up_at === 'string'
      ? row.follow_up_at
      : row.follow_up_at === null || row.follow_up_at === undefined
        ? null
        : null

  const marketingConsent =
    row.marketing_consent === true || row.marketing_consent === false
      ? row.marketing_consent
      : null
  if (marketingConsent === null) {
    return null
  }

  const marketingConsentAt =
    typeof row.marketing_consent_at === 'string'
      ? row.marketing_consent_at
      : row.marketing_consent_at === null || row.marketing_consent_at === undefined
        ? null
        : null

  if (
    (marketingConsent && marketingConsentAt === null) ||
    (!marketingConsent && marketingConsentAt !== null)
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
    followUpAt,
    marketingConsent,
    marketingConsentAt,
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

function parseNoteRow(row: Record<string, unknown>): SchoolRegistrationNote | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.registration_id !== 'string' ||
    typeof row.author_user_id !== 'string' ||
    typeof row.note_text !== 'string' ||
    typeof row.created_at !== 'string'
  ) {
    return null
  }
  return {
    id: row.id,
    registrationId: row.registration_id,
    authorUserId: row.author_user_id,
    noteText: row.note_text,
    createdAt: row.created_at,
  }
}

function parseActivityRow(row: Record<string, unknown>): SchoolRegistrationActivity | null {
  const eventType = parseActivityEventType(row.event_type)
  if (
    typeof row.id !== 'string' ||
    typeof row.registration_id !== 'string' ||
    !eventType ||
    typeof row.created_at !== 'string'
  ) {
    return null
  }
  const payload =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {}
  return {
    id: row.id,
    registrationId: row.registration_id,
    eventType,
    actorUserId: typeof row.actor_user_id === 'string' ? row.actor_user_id : null,
    payload,
    createdAt: row.created_at,
  }
}

function mutationErrorMessage(fallback: string, error: { message?: string } | null): string {
  const message = error?.message ?? ''
  if (/Note text is required/i.test(message)) {
    return 'לא ניתן לשמור הערה ריקה.'
  }
  if (/Note text is too long/i.test(message)) {
    return 'ההערה ארוכה מדי.'
  }
  if (/Invalid status/i.test(message)) {
    return 'סטטוס לא תקין.'
  }
  if (/Registration not found/i.test(message)) {
    return 'ההרשמה לא נמצאה.'
  }
  if (/Permission denied|42501/i.test(message)) {
    return 'אין הרשאה לביצוע הפעולה.'
  }
  return fallback
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

export async function updateSchoolRegistrationStatusForPlatformAdmin(
  registrationId: string,
  status: SchoolRegistrationStatus,
): Promise<MutationResult> {
  if (!isSchoolRegistrationStatus(status)) {
    return { ok: false, errorMessage: 'סטטוס לא תקין.' }
  }

  const { data, error } = await supabase.rpc(
    'platform_admin_update_school_registration_status',
    {
      p_registration_id: registrationId,
      p_new_status: status,
    },
  )

  if (error) {
    console.error('[schoolRegistration] status update failed', error)
    return {
      ok: false,
      errorMessage: mutationErrorMessage('עדכון הסטטוס נכשל.', error),
    }
  }

  if (!data || (data as { ok?: boolean }).ok !== true) {
    return { ok: false, errorMessage: 'עדכון הסטטוס נכשל.' }
  }

  return { ok: true }
}

export async function addSchoolRegistrationNoteForPlatformAdmin(
  registrationId: string,
  rawNote: string,
): Promise<MutationResult> {
  const validation = validateInternalNoteText(rawNote)
  if (!validation.ok) {
    return { ok: false, errorMessage: validation.errorMessage }
  }

  const { data, error } = await supabase.rpc('platform_admin_add_school_registration_note', {
    p_registration_id: registrationId,
    p_note_text: validation.noteText,
  })

  if (error) {
    console.error('[schoolRegistration] add note failed', error)
    return {
      ok: false,
      errorMessage: mutationErrorMessage('שמירת ההערה נכשלה.', error),
    }
  }

  if (!data || (data as { ok?: boolean }).ok !== true) {
    return { ok: false, errorMessage: 'שמירת ההערה נכשלה.' }
  }

  return { ok: true }
}

export async function setSchoolRegistrationFollowUpForPlatformAdmin(
  registrationId: string,
  followUpAt: string | null,
): Promise<MutationResult> {
  const { data, error } = await supabase.rpc(
    'platform_admin_set_school_registration_follow_up',
    {
      p_registration_id: registrationId,
      p_follow_up_at: followUpAt,
    },
  )

  if (error) {
    console.error('[schoolRegistration] follow-up update failed', error)
    return {
      ok: false,
      errorMessage: mutationErrorMessage('עדכון המעקב נכשל.', error),
    }
  }

  if (!data || (data as { ok?: boolean }).ok !== true) {
    return { ok: false, errorMessage: 'עדכון המעקב נכשל.' }
  }

  return { ok: true }
}

export async function loadSchoolRegistrationNotesForPlatformAdmin(
  registrationId: string,
): Promise<LoadNotesResult> {
  const { data, error } = await supabase.rpc('platform_admin_list_school_registration_notes', {
    p_registration_id: registrationId,
  })

  if (error) {
    console.error('[schoolRegistration] notes list failed', error)
    return { ok: false, errorMessage: 'טעינת ההערות נכשלה.' }
  }

  const notes = (Array.isArray(data) ? data : [])
    .map((row) => parseNoteRow(row as Record<string, unknown>))
    .filter((row): row is SchoolRegistrationNote => row !== null)

  return { ok: true, notes }
}

export async function loadSchoolRegistrationActivityForPlatformAdmin(
  registrationId: string,
): Promise<LoadActivityResult> {
  const { data, error } = await supabase.rpc(
    'platform_admin_list_school_registration_activity',
    {
      p_registration_id: registrationId,
    },
  )

  if (error) {
    console.error('[schoolRegistration] activity list failed', error)
    return { ok: false, errorMessage: 'טעינת ציר הזמן נכשלה.' }
  }

  const activities = (Array.isArray(data) ? data : [])
    .map((row) => parseActivityRow(row as Record<string, unknown>))
    .filter((row): row is SchoolRegistrationActivity => row !== null)

  return { ok: true, activities }
}
