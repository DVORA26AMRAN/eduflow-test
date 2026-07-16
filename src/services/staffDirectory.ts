import type {
  LoadStaffDirectoryResult,
  LoadStaffMemberDetailsResult,
  StaffDirectoryMember,
  StaffMemberDetails,
  UpdateStaffMemberInput,
  UpdateStaffMemberResult,
} from '../types/staffDirectory'
import { supabase } from './supabase'

function parseOptionalText(value: unknown): string | null | undefined {
  if (value === null) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  return undefined
}

function parseWeeklyHours(value: unknown): number | null | undefined {
  if (value === null) {
    return null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function parseStaffDirectoryMember(row: Record<string, unknown>): StaffDirectoryMember | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.full_name !== 'string' ||
    typeof row.email !== 'string' ||
    typeof row.status !== 'string' ||
    typeof row.created_at !== 'string'
  ) {
    return null
  }

  const phone = parseOptionalText(row.phone)
  const jobTitle = parseOptionalText(row.job_title)
  const weeklyHours = parseWeeklyHours(row.weekly_hours)

  if (phone === undefined || jobTitle === undefined || weeklyHours === undefined) {
    return null
  }

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone,
    jobTitle,
    weeklyHours,
    status: row.status,
    createdAt: row.created_at,
  }
}

function parseStaffMemberDetails(row: Record<string, unknown>): StaffMemberDetails | null {
  const base = parseStaffDirectoryMember(row)
  if (!base) {
    return null
  }

  const nationalId = parseOptionalText(row.national_id)
  if (nationalId === undefined) {
    return null
  }

  return {
    ...base,
    nationalId,
  }
}

function mapStaffDirectoryError(rawMessage: string | null | undefined): string {
  if (!rawMessage) {
    return 'לא ניתן לטעון את ספר העובדים.'
  }

  const message = rawMessage.toLowerCase()
  if (
    message.includes('permission denied') ||
    message.includes('42501') ||
    message.includes('unauthorized')
  ) {
    return 'אין הרשאה לצפות בספר העובדים.'
  }

  return 'לא ניתן לטעון את ספר העובדים.'
}

export async function loadStaffDirectory(): Promise<LoadStaffDirectoryResult> {
  const { data, error } = await supabase.rpc('get_staff_directory')

  if (error) {
    console.error('[staffDirectory] failed to load directory', error)
    return { ok: false, errorMessage: mapStaffDirectoryError(error.message) }
  }

  if (!Array.isArray(data)) {
    return { ok: false, errorMessage: 'לא ניתן לטעון את ספר העובדים.' }
  }

  const members: StaffDirectoryMember[] = []
  for (const row of data) {
    if (!row || typeof row !== 'object') {
      return { ok: false, errorMessage: 'לא ניתן לטעון את ספר העובדים.' }
    }
    const parsed = parseStaffDirectoryMember(row as Record<string, unknown>)
    if (!parsed) {
      return { ok: false, errorMessage: 'לא ניתן לטעון את ספר העובדים.' }
    }
    members.push(parsed)
  }

  return { ok: true, members }
}

export async function loadStaffMemberDetails(
  userId: string,
): Promise<LoadStaffMemberDetailsResult> {
  if (!userId.trim()) {
    return { ok: false, errorMessage: 'אין הרשאה לצפות בספר העובדים.' }
  }

  const { data, error } = await supabase.rpc('get_staff_member_details', {
    p_user_id: userId,
  })

  if (error) {
    console.error('[staffDirectory] failed to load member details', error)
    return { ok: false, errorMessage: mapStaffDirectoryError(error.message) }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') {
    return { ok: false, errorMessage: 'לא ניתן לטעון את ספר העובדים.' }
  }

  const member = parseStaffMemberDetails(row as Record<string, unknown>)
  if (!member) {
    return { ok: false, errorMessage: 'לא ניתן לטעון את ספר העובדים.' }
  }

  return { ok: true, member }
}

export async function updateStaffMember(
  input: UpdateStaffMemberInput,
): Promise<UpdateStaffMemberResult> {
  const { data, error } = await supabase.rpc('update_staff_member', {
    p_user_id: input.userId,
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_job_title: input.jobTitle,
    p_weekly_hours: input.weeklyHours,
    p_national_id: input.nationalId,
  })

  if (error) {
    console.error('[staffDirectory] failed to update staff member', error)
    return { ok: false, errorMessage: 'העדכון נכשל.' }
  }

  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
    return { ok: false, errorMessage: 'העדכון נכשל.' }
  }

  return { ok: true }
}
