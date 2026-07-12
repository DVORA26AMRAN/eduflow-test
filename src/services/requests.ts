import type {
  ArchivedTeacherRequest,
  CreateRequestInput,
  GeneralRequestRecipientRole,
  RequestPayload,
  RequestStatus,
  RequestStatusHistoryEntry,
  SecretaryArchivedRequest,
  SecretaryInboxRequest,
  TeacherRequest,
} from '../types/request'
import { isGeneralRequestRecipientRole } from '../utils/generalRequestDisplay'
import { isRequestStatus, isRequestType } from '../utils/requests'
import { supabase } from './supabase'

export type LoadTeacherRequestsResult =
  | { ok: true; requests: TeacherRequest[] }
  | { ok: false; errorMessage: string }

export type LoadMyArchivedRequestsResult =
  | { ok: true; requests: ArchivedTeacherRequest[] }
  | { ok: false; errorMessage: string }

export type CreateTeacherRequestResult =
  | { ok: true; requestId: string }
  | { ok: false; errorMessage: string }

export type LoadSecretaryRequestsResult =
  | { ok: true; requests: SecretaryInboxRequest[] }
  | { ok: false; errorMessage: string }

export type LoadSecretaryArchivedRequestsResult =
  | { ok: true; requests: SecretaryArchivedRequest[]; totalCount: number }
  | { ok: false; errorMessage: string }

export type LoadSecretaryArchivedRequestsParams = {
  dateFrom?: string
  dateTo?: string
  page: number
  pageSize: number
}

export type UpdateRequestStatusResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type ArchiveRequestResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type ArchiveRequestAsSecretaryResult = ArchiveRequestResult

export type LoadRequestStatusHistoryResult =
  | { ok: true; entries: RequestStatusHistoryEntry[] }
  | { ok: false; errorMessage: string }

async function loadCurrentUserInstitutionId(
  userId: string,
): Promise<{ ok: true; institutionId: string } | { ok: false }> {
  const { data, error } = await supabase
    .from('users')
    .select('institution_id')
    .eq('id', userId)
    .single()

  if (error || typeof data?.institution_id !== 'string') {
    console.error('[requests] failed to load institution_id', error)
    return { ok: false }
  }

  return { ok: true, institutionId: data.institution_id }
}

function parseRecipientRole(value: unknown): GeneralRequestRecipientRole | null {
  if (typeof value !== 'string' || !isGeneralRequestRecipientRole(value)) {
    return null
  }

  return value
}

function parseRequestPayload(value: unknown): RequestPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as RequestPayload
}

function parseTeacherRequest(row: {
  id: unknown
  request_type: unknown
  description: unknown
  status: unknown
  created_at: unknown
  recipient_role?: unknown
  request_payload?: unknown
}): TeacherRequest | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.description !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.request_type !== 'string' ||
    typeof row.status !== 'string' ||
    !isRequestType(row.request_type) ||
    !isRequestStatus(row.status)
  ) {
    return null
  }

  return {
    id: row.id,
    request_type: row.request_type,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    recipient_role: parseRecipientRole(row.recipient_role),
    request_payload: parseRequestPayload(row.request_payload),
  }
}

export async function loadTeacherRequests(): Promise<LoadTeacherRequestsResult> {
  const { data, error } = await supabase
    .from('requests')
    .select('id, request_type, description, status, created_at, recipient_role, request_payload')
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[requests] failed to load teacher requests', error)
    return {
      ok: false,
      errorMessage: 'לא ניתן לטעון את הבקשות.',
    }
  }

  const requests = (data ?? [])
    .map(parseTeacherRequest)
    .filter((request): request is TeacherRequest => request !== null)

  return { ok: true, requests }
}

function parseArchivedTeacherRequest(row: {
  id: unknown
  request_type: unknown
  description: unknown
  status: unknown
  created_at: unknown
  archived_at: unknown
}): ArchivedTeacherRequest | null {
  const base = parseTeacherRequest(row)
  if (!base || typeof row.archived_at !== 'string') {
    return null
  }

  return {
    ...base,
    archived_at: row.archived_at,
  }
}

export async function loadMyArchivedRequests(): Promise<LoadMyArchivedRequestsResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[requests] no authenticated session for archive load', sessionError)
    console.error('[requests][archive][diagnostic]', {
      branch: 'no_session',
      message: sessionError?.message ?? null,
      code: sessionError?.code ?? null,
      details: null,
      hint: null,
    })
    return {
      ok: false,
      errorMessage: 'לא ניתן לטעון את הארכיון.',
    }
  }

  const userId = sessionData.session.user.id

  const { data, error } = await supabase
    .from('requests')
    .select('id, request_type, description, status, created_at, archived_at')
    .eq('created_by_user_id', userId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })

  if (error) {
    console.error('[requests] failed to load archived requests', error)
    console.error('[requests][archive][diagnostic]', {
      branch: 'supabase_query_error',
      message: error.message ?? null,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    })
    return {
      ok: false,
      errorMessage: 'לא ניתן לטעון את הארכיון.',
    }
  }

  const requests = (data ?? [])
    .map(parseArchivedTeacherRequest)
    .filter((request): request is ArchivedTeacherRequest => request !== null)

  return { ok: true, requests }
}

function extractTeacherFullName(users: unknown): string | null {
  if (Array.isArray(users)) {
    const first = users[0] as { full_name?: unknown } | undefined
    return typeof first?.full_name === 'string' ? first.full_name : null
  }

  if (users && typeof users === 'object' && 'full_name' in users) {
    const fullName = (users as { full_name: unknown }).full_name
    return typeof fullName === 'string' ? fullName : null
  }

  return null
}

function parseSecretaryInboxRequest(row: {
  id: unknown
  request_type: unknown
  description: unknown
  status: unknown
  created_at: unknown
  users: unknown
  request_payload?: unknown
}): SecretaryInboxRequest | null {
  const teacherFullName = extractTeacherFullName(row.users)

  if (
    typeof row.id !== 'string' ||
    typeof row.description !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.request_type !== 'string' ||
    typeof row.status !== 'string' ||
    teacherFullName === null ||
    !isRequestType(row.request_type) ||
    !isRequestStatus(row.status)
  ) {
    return null
  }

  return {
    id: row.id,
    request_type: row.request_type,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    teacher_full_name: teacherFullName,
    request_payload: parseRequestPayload(row.request_payload),
  }
}

export async function loadSecretaryRequests(): Promise<LoadSecretaryRequestsResult> {
  const { data, error } = await supabase
    .from('requests')
    .select(
      'id, request_type, description, status, created_at, request_payload, users!created_by_user_id(full_name)',
    )
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[requests] failed to load secretary inbox requests', error)
    return {
      ok: false,
      errorMessage: 'לא ניתן לטעון את הבקשות.',
    }
  }

  const requests = (data ?? [])
    .map(parseSecretaryInboxRequest)
    .filter((request): request is SecretaryInboxRequest => request !== null)

  return { ok: true, requests }
}

function parseSecretaryArchivedRequest(row: {
  id: unknown
  request_type: unknown
  status: unknown
  created_at: unknown
  archived_at: unknown
  users: unknown
}): SecretaryArchivedRequest | null {
  const teacherFullName = extractTeacherFullName(row.users)

  if (
    typeof row.id !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.archived_at !== 'string' ||
    typeof row.request_type !== 'string' ||
    typeof row.status !== 'string' ||
    teacherFullName === null ||
    !isRequestType(row.request_type) ||
    !isRequestStatus(row.status)
  ) {
    return null
  }

  return {
    id: row.id,
    request_type: row.request_type,
    status: row.status,
    created_at: row.created_at,
    archived_at: row.archived_at,
    teacher_full_name: teacherFullName,
  }
}

export async function loadSecretaryArchivedRequests(
  params: LoadSecretaryArchivedRequestsParams,
): Promise<LoadSecretaryArchivedRequestsResult> {
  const page = Math.max(1, params.page)
  const pageSize = Math.max(1, params.pageSize)
  const rangeFrom = (page - 1) * pageSize
  const rangeTo = rangeFrom + pageSize - 1

  let query = supabase
    .from('requests')
    .select(
      'id, request_type, status, created_at, archived_at, users!created_by_user_id(full_name)',
      { count: 'exact' },
    )
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })

  if (params.dateFrom) {
    query = query.gte('archived_at', `${params.dateFrom}T00:00:00`)
  }

  if (params.dateTo) {
    query = query.lte('archived_at', `${params.dateTo}T23:59:59.999`)
  }

  const { data, error, count } = await query.range(rangeFrom, rangeTo)

  if (error) {
    console.error('[requests] failed to load secretary archived requests', error)
    return {
      ok: false,
      errorMessage: 'לא ניתן לטעון את הארכיון המוסדי.',
    }
  }

  const requests = (data ?? [])
    .map(parseSecretaryArchivedRequest)
    .filter((request): request is SecretaryArchivedRequest => request !== null)

  return { ok: true, requests, totalCount: count ?? 0 }
}

export async function updateRequestStatus(
  requestId: string,
  status: RequestStatus,
): Promise<UpdateRequestStatusResult> {
  const { error } = await supabase.from('requests').update({ status }).eq('id', requestId)

  if (error) {
    console.error('[requests] failed to update request status', error)
    return {
      ok: false,
      errorMessage: 'עדכון סטטוס הבקשה נכשל.',
    }
  }

  return { ok: true }
}

export async function archiveRequest(requestId: string): Promise<ArchiveRequestResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[requests] no authenticated session for archive', sessionError)
    return {
      ok: false,
      errorMessage: 'לא ניתן להעביר את הבקשה לארכיון כרגע.',
    }
  }

  const userId = sessionData.session.user.id
  const archivedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('requests')
    .update({
      archived_at: archivedAt,
      archived_by_user_id: userId,
    })
    .eq('id', requestId)
    .eq('created_by_user_id', userId)
    .is('archived_at', null)
    .select('id')

  if (error) {
    console.error('[requests] failed to archive request', error)
    return {
      ok: false,
      errorMessage: 'העברת הבקשה לארכיון נכשלה.',
    }
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      errorMessage: 'לא ניתן להעביר בקשה זו לארכיון.',
    }
  }

  if (data.length !== 1 || data[0]?.id !== requestId) {
    console.error('[requests] archive postcondition failed: unexpected updated rows', {
      requestId,
      updatedRows: data,
    })
    return {
      ok: false,
      errorMessage: 'לא ניתן להעביר בקשה זו לארכיון.',
    }
  }

  const { data: archivedRow, error: archivedRowError } = await supabase
    .from('requests')
    .select('id, archived_at')
    .eq('id', requestId)
    .eq('created_by_user_id', userId)
    .single()

  if (archivedRowError || !archivedRow || typeof archivedRow.archived_at !== 'string') {
    console.error('[requests] archive postcondition failed: row not archived after update', {
      requestId,
      archivedRowError,
      archivedRow,
    })
    return {
      ok: false,
      errorMessage: 'לא ניתן להעביר בקשה זו לארכיון.',
    }
  }

  return { ok: true }
}

export async function archiveRequestAsSecretary(
  requestId: string,
): Promise<ArchiveRequestAsSecretaryResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[requests] no authenticated session for secretary archive', sessionError)
    return {
      ok: false,
      errorMessage: 'לא ניתן להעביר את הבקשה לארכיון כרגע.',
    }
  }

  const userId = sessionData.session.user.id
  const archivedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('requests')
    .update({
      archived_at: archivedAt,
      archived_by_user_id: userId,
    })
    .eq('id', requestId)
    .in('status', ['completed', 'rejected'])
    .is('archived_at', null)
    .select('id')

  if (error) {
    console.error('[requests] failed to archive request as secretary', error)
    return {
      ok: false,
      errorMessage: 'העברת הבקשה לארכיון נכשלה.',
    }
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      errorMessage: 'לא ניתן להעביר בקשה זו לארכיון.',
    }
  }

  if (data.length !== 1 || data[0]?.id !== requestId) {
    console.error('[requests] secretary archive postcondition failed: unexpected updated rows', {
      requestId,
      updatedRows: data,
    })
    return {
      ok: false,
      errorMessage: 'לא ניתן להעביר בקשה זו לארכיון.',
    }
  }

  const { data: archivedRow, error: archivedRowError } = await supabase
    .from('requests')
    .select('id, archived_at')
    .eq('id', requestId)
    .single()

  if (archivedRowError || !archivedRow || typeof archivedRow.archived_at !== 'string') {
    console.error('[requests] secretary archive postcondition failed: row not archived after update', {
      requestId,
      archivedRowError,
      archivedRow,
    })
    return {
      ok: false,
      errorMessage: 'לא ניתן להעביר בקשה זו לארכיון.',
    }
  }

  return { ok: true }
}

function extractUserFullName(users: unknown): string | null {
  if (Array.isArray(users)) {
    const first = users[0] as { full_name?: unknown } | undefined
    return typeof first?.full_name === 'string' ? first.full_name : null
  }

  if (users && typeof users === 'object' && 'full_name' in users) {
    const fullName = (users as { full_name: unknown }).full_name
    return typeof fullName === 'string' ? fullName : null
  }

  return null
}

function parseRequestStatusHistoryEntry(row: {
  id: unknown
  previous_status: unknown
  new_status: unknown
  created_at: unknown
  users: unknown
}): RequestStatusHistoryEntry | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.previous_status !== 'string' ||
    typeof row.new_status !== 'string' ||
    !isRequestStatus(row.previous_status) ||
    !isRequestStatus(row.new_status)
  ) {
    return null
  }

  return {
    id: row.id,
    previous_status: row.previous_status,
    new_status: row.new_status,
    created_at: row.created_at,
    changed_by_full_name: extractUserFullName(row.users),
  }
}

export async function loadRequestStatusHistory(
  requestId: string,
): Promise<LoadRequestStatusHistoryResult> {
  const { data, error } = await supabase
    .from('request_status_history')
    .select(
      'id, previous_status, new_status, created_at, users!changed_by_user_id(full_name)',
    )
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[requests] failed to load request status history', error)
    return {
      ok: false,
      errorMessage: 'טעינת היסטוריית הסטטוסים נכשלה.',
    }
  }

  const entries = (data ?? [])
    .map(parseRequestStatusHistoryEntry)
    .filter((entry): entry is RequestStatusHistoryEntry => entry !== null)

  return { ok: true, entries }
}

export async function createTeacherRequest(
  input: CreateRequestInput,
): Promise<CreateTeacherRequestResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[requests] no authenticated session for create', sessionError)
    return {
      ok: false,
      errorMessage: 'שליחת הבקשה נכשלה.',
    }
  }

  const userId = sessionData.session.user.id
  const institutionResult = await loadCurrentUserInstitutionId(userId)

  if (!institutionResult.ok) {
    return {
      ok: false,
      errorMessage: 'שליחת הבקשה נכשלה.',
    }
  }

  const { data, error } = await supabase
    .from('requests')
    .insert({
      institution_id: institutionResult.institutionId,
      created_by_user_id: userId,
      request_type: input.requestType,
      description: input.description.trim(),
      request_payload: input.requestPayload ?? {},
      recipient_role: input.recipientRole ?? null,
    })
    .select('id')
    .single()

  if (error || typeof data?.id !== 'string') {
    console.error('[requests] failed to create request', error)
    return {
      ok: false,
      errorMessage: 'שליחת הבקשה נכשלה.',
    }
  }

  return { ok: true, requestId: data.id }
}
