import type {
  InstitutionAdminRecord,
  InstitutionFormFields,
  InstitutionManagerInviteFields,
  InstitutionManagerRecord,
} from '../types/institutionAdmin'
import { validateInstitutionForm } from '../utils/institutionForm'
import { validateInstitutionManagerInvite } from '../utils/institutionManagerInvite'
import { supabase, supabaseUrl } from './supabase'

export type LoadInstitutionsAdminResult =
  | { ok: true; institutions: InstitutionAdminRecord[] }
  | { ok: false; errorMessage: string }

export type LoadInstitutionAdminResult =
  | { ok: true; institution: InstitutionAdminRecord }
  | { ok: false; errorMessage: string }

export type MutateInstitutionResult =
  | { ok: true; institutionId: string }
  | { ok: false; errorMessage: string }

function parseOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  return null
}

function parseInstitutionAdminRow(row: Record<string, unknown>): InstitutionAdminRecord | null {
  if (typeof row.id !== 'string' || typeof row.name !== 'string') {
    return null
  }

  return {
    id: row.id,
    name: row.name,
    institutionCode: parseOptionalText(row.institution_code),
    address: parseOptionalText(row.address),
    city: parseOptionalText(row.city),
    phone: parseOptionalText(row.phone),
    email: parseOptionalText(row.email),
    logoUrl: typeof row.logo_url === 'string' ? row.logo_url : null,
    logoUpdatedAt: typeof row.logo_updated_at === 'string' ? row.logo_updated_at : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

function mapAdminError(rawMessage: string | null | undefined, fallback: string): string {
  if (!rawMessage) {
    return fallback
  }

  const message = rawMessage.toLowerCase()
  if (message.includes('permission denied') || message.includes('42501')) {
    return 'אין הרשאה לבצע פעולה זו.'
  }
  if (message.includes('institution code already exists') || message.includes('23505')) {
    return 'סמל המוסד כבר קיים במערכת.'
  }
  if (message.includes('valid email') || message.includes('email')) {
    return 'כתובת האימייל אינה תקינה.'
  }
  if (message.includes('phone')) {
    return 'מספר הטלפון אינו תקין.'
  }
  if (message.includes('not found') || message.includes('p0002')) {
    return 'בית הספר לא נמצא.'
  }
  if (message.includes('required')) {
    return 'נא למלא את כל השדות החובה.'
  }

  return fallback
}

export async function loadInstitutionsForPlatformAdmin(): Promise<LoadInstitutionsAdminResult> {
  const { data, error } = await supabase.rpc('platform_admin_list_institutions')

  if (error) {
    console.error('[institutionAdmin] list failed', error)
    return {
      ok: false,
      errorMessage: mapAdminError(error.message, 'לא ניתן לטעון את רשימת בתי הספר.'),
    }
  }

  if (!Array.isArray(data)) {
    return { ok: false, errorMessage: 'לא ניתן לטעון את רשימת בתי הספר.' }
  }

  const institutions: InstitutionAdminRecord[] = []
  for (const row of data) {
    if (!row || typeof row !== 'object') {
      return { ok: false, errorMessage: 'לא ניתן לטעון את רשימת בתי הספר.' }
    }
    const parsed = parseInstitutionAdminRow(row as Record<string, unknown>)
    if (!parsed) {
      return { ok: false, errorMessage: 'לא ניתן לטעון את רשימת בתי הספר.' }
    }
    institutions.push(parsed)
  }

  return { ok: true, institutions }
}

export async function loadInstitutionForPlatformAdmin(
  institutionId: string,
): Promise<LoadInstitutionAdminResult> {
  const { data, error } = await supabase.rpc('platform_admin_get_institution', {
    p_institution_id: institutionId,
  })

  if (error) {
    console.error('[institutionAdmin] get failed', error)
    return {
      ok: false,
      errorMessage: mapAdminError(error.message, 'לא ניתן לטעון את פרטי בית הספר.'),
    }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') {
    return { ok: false, errorMessage: 'בית הספר לא נמצא.' }
  }

  const parsed = parseInstitutionAdminRow(row as Record<string, unknown>)
  if (!parsed) {
    return { ok: false, errorMessage: 'לא ניתן לטעון את פרטי בית הספר.' }
  }

  return { ok: true, institution: parsed }
}

export async function createInstitutionAsPlatformAdmin(
  fields: InstitutionFormFields,
): Promise<MutateInstitutionResult> {
  const validation = validateInstitutionForm(fields)
  if (!validation.ok) {
    return validation
  }

  const { data, error } = await supabase.rpc('platform_admin_create_institution', {
    p_name: validation.values.name,
    p_institution_code: validation.values.institutionCode,
    p_address: validation.values.address,
    p_city: validation.values.city,
    p_phone: validation.values.phone,
    p_email: validation.values.email,
  })

  if (error) {
    console.error('[institutionAdmin] create failed', error)
    return {
      ok: false,
      errorMessage: mapAdminError(error.message, 'יצירת בית הספר נכשלה.'),
    }
  }

  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
    return { ok: false, errorMessage: 'יצירת בית הספר נכשלה.' }
  }

  const institutionId = (data as { institution_id?: unknown }).institution_id
  if (typeof institutionId !== 'string') {
    return { ok: false, errorMessage: 'יצירת בית הספר נכשלה.' }
  }

  return { ok: true, institutionId }
}

export async function updateInstitutionAsPlatformAdmin(
  institutionId: string,
  fields: InstitutionFormFields,
): Promise<MutateInstitutionResult> {
  const validation = validateInstitutionForm(fields)
  if (!validation.ok) {
    return validation
  }

  const { data, error } = await supabase.rpc('platform_admin_update_institution', {
    p_institution_id: institutionId,
    p_name: validation.values.name,
    p_institution_code: validation.values.institutionCode,
    p_address: validation.values.address,
    p_city: validation.values.city,
    p_phone: validation.values.phone,
    p_email: validation.values.email,
  })

  if (error) {
    console.error('[institutionAdmin] update failed', error)
    return {
      ok: false,
      errorMessage: mapAdminError(error.message, 'עדכון בית הספר נכשל.'),
    }
  }

  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
    return { ok: false, errorMessage: 'עדכון בית הספר נכשל.' }
  }

  const returnedId = (data as { institution_id?: unknown }).institution_id
  if (typeof returnedId !== 'string' || returnedId !== institutionId) {
    return { ok: false, errorMessage: 'עדכון בית הספר נכשל.' }
  }

  return { ok: true, institutionId }
}

export type LoadInstitutionManagerResult =
  | { ok: true; manager: InstitutionManagerRecord | null }
  | { ok: false; errorMessage: string }

export type InviteInstitutionManagerResult =
  | { ok: true; resent?: boolean }
  | { ok: false; errorMessage: string }

function parseInstitutionManagerRow(row: Record<string, unknown>): InstitutionManagerRecord | null {
  if (
    typeof row.user_id !== 'string' ||
    typeof row.full_name !== 'string' ||
    typeof row.email !== 'string' ||
    typeof row.status !== 'string'
  ) {
    return null
  }

  return {
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    onboardingCompletedAt:
      typeof row.onboarding_completed_at === 'string' ? row.onboarding_completed_at : null,
  }
}

export async function loadInstitutionManagerForPlatformAdmin(
  institutionId: string,
): Promise<LoadInstitutionManagerResult> {
  const { data, error } = await supabase.rpc('platform_admin_get_institution_manager', {
    p_institution_id: institutionId,
  })

  if (error) {
    console.error('[institutionAdmin] get manager failed', error)
    return {
      ok: false,
      errorMessage: mapAdminError(error.message, 'לא ניתן לטעון את פרטי המנהלת.'),
    }
  }

  if (data === null || data === undefined) {
    return { ok: true, manager: null }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    return { ok: true, manager: null }
  }

  if (typeof row !== 'object') {
    return { ok: false, errorMessage: 'לא ניתן לטעון את פרטי המנהלת.' }
  }

  const parsed = parseInstitutionManagerRow(row as Record<string, unknown>)
  if (!parsed) {
    return { ok: false, errorMessage: 'לא ניתן לטעון את פרטי המנהלת.' }
  }

  return { ok: true, manager: parsed }
}

function mapManagerInviteHttpError(status: number, bodyText: string): string {
  let code = ''
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown }
    if (typeof parsed.error === 'string') {
      code = parsed.error
    }
  } catch {
    // ignore
  }

  if (status === 401) {
    return 'ההתחברות פגה. נא להתחבר מחדש.'
  }
  if (status === 403 || code === 'forbidden') {
    return 'אין הרשאה לבצע פעולה זו.'
  }
  if (status === 404 || code === 'institution_not_found') {
    return 'בית הספר לא נמצא.'
  }
  if (code === 'manager_slot_occupied' || code === 'manager_already_joined') {
    return 'כבר קיימת מנהלת פעילה לבית הספר הזה.'
  }
  if (code === 'repair_required') {
    return 'כתובת המייל קשורה לחשבון שדורש תיקון ידני.'
  }
  if (status === 409 || code === 'conflict') {
    return 'משתמש עם כתובת המייל הזו כבר קיים.'
  }

  return 'הזמנת המנהלת נכשלה.'
}

export async function inviteInstitutionManagerAsPlatformAdmin(
  institutionId: string,
  fields: InstitutionManagerInviteFields,
): Promise<InviteInstitutionManagerResult> {
  const validation = validateInstitutionManagerInvite(fields)
  if (!validation.ok) {
    return validation
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) {
    return { ok: false, errorMessage: 'אין התחברות פעילה.' }
  }

  if (!supabaseUrl) {
    return { ok: false, errorMessage: 'הזמנת המנהלת נכשלה.' }
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/clever-processor`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      full_name: validation.values.fullName,
      email: validation.values.email,
      role: 'institution_manager',
      institution_id: institutionId,
    }),
  })

  const bodyText = await response.text()

  if (response.status === 201 || response.status === 200) {
    let resent = false
    try {
      const parsed = JSON.parse(bodyText) as { resent?: unknown }
      resent = parsed.resent === true
    } catch {
      // ignore
    }
    return { ok: true, resent }
  }

  console.error('[institutionAdmin] invite manager failed', {
    status: response.status,
    body: bodyText,
  })

  return {
    ok: false,
    errorMessage: mapManagerInviteHttpError(response.status, bodyText),
  }
}
