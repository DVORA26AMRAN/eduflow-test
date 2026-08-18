import {
  filterEligibleHandlersForRequest,
  isEligibleHandlerRole,
  type EligibleHandlerRole,
  type HandlerHistoryAction,
} from '../domain/requestOwnership'
import type { GeneralRequestRecipientRole, RequestStatus, RequestType } from '../types/request'
import type {
  RequestHandlerHistoryEntry,
  RequestHandlerOption,
  RequestOwnershipErrorCode,
} from '../types/requestOwnership'
import { REQUEST_OWNERSHIP_MESSAGES } from '../types/requestOwnership'
import { supabase } from './supabase'

export type ClaimRequestResult =
  | { ok: true; handledByUserId: string; status: RequestStatus; unchanged?: boolean }
  | { ok: false; errorCode: RequestOwnershipErrorCode; errorMessage: string }

export type TransferRequestHandlerResult =
  | { ok: true; handledByUserId: string; status: RequestStatus; unchanged?: boolean }
  | { ok: false; errorCode: RequestOwnershipErrorCode; errorMessage: string }

export type ReleaseRequestHandlerResult =
  | { ok: true; handledByUserId: null; status: RequestStatus }
  | { ok: false; errorCode: RequestOwnershipErrorCode; errorMessage: string }

export type LoadEligibleRequestHandlersResult =
  | { ok: true; handlers: RequestHandlerOption[] }
  | { ok: false; errorMessage: string }

export type LoadRequestHandlerHistoryResult =
  | { ok: true; entries: RequestHandlerHistoryEntry[] }
  | { ok: false; errorMessage: string }

function parseErrorCode(value: unknown): RequestOwnershipErrorCode {
  if (
    value === 'REQUEST_ALREADY_CLAIMED' ||
    value === 'REQUEST_FINAL_STATE' ||
    value === 'REQUEST_ARCHIVED' ||
    value === 'REQUEST_NOT_ASSIGNED' ||
    value === 'REQUEST_NOT_CLAIMABLE' ||
    value === 'REQUEST_RELEASE_NOT_ALLOWED'
  ) {
    return value
  }

  if (typeof value === 'string' && value.toLowerCase().includes('permission denied')) {
    return 'PERMISSION_DENIED'
  }

  return 'UNKNOWN'
}

function failFromRpc(
  error: { message?: string } | null,
  data: unknown,
): { errorCode: RequestOwnershipErrorCode; errorMessage: string } {
  const payload =
    data && typeof data === 'object' && 'error' in data
      ? (data as { error?: unknown; ok?: unknown })
      : null

  if (payload && payload.ok === false) {
    const errorCode = parseErrorCode(payload.error)
    return { errorCode, errorMessage: REQUEST_OWNERSHIP_MESSAGES[errorCode] }
  }

  const errorCode = parseErrorCode(error?.message)
  return { errorCode, errorMessage: REQUEST_OWNERSHIP_MESSAGES[errorCode] }
}

function parseStatus(value: unknown): RequestStatus | null {
  if (value === 'new' || value === 'in_progress' || value === 'completed' || value === 'rejected') {
    return value
  }
  return null
}

function parseJoinedName(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value[0] as { full_name?: unknown } | undefined
    return typeof first?.full_name === 'string' ? first.full_name : null
  }

  if (value && typeof value === 'object' && 'full_name' in value) {
    const fullName = (value as { full_name: unknown }).full_name
    return typeof fullName === 'string' ? fullName : null
  }

  return null
}

export async function claimRequest(requestId: string): Promise<ClaimRequestResult> {
  const { data, error } = await supabase.rpc('claim_request', {
    p_request_id: requestId,
  })

  if (error || !data || typeof data !== 'object') {
    return { ok: false, ...failFromRpc(error, data) }
  }

  const payload = data as {
    ok?: unknown
    unchanged?: unknown
    handled_by_user_id?: unknown
    status?: unknown
    error?: unknown
  }

  if (payload.ok === false) {
    const errorCode = parseErrorCode(payload.error)
    return { ok: false, errorCode, errorMessage: REQUEST_OWNERSHIP_MESSAGES[errorCode] }
  }

  const handledByUserId =
    typeof payload.handled_by_user_id === 'string' ? payload.handled_by_user_id : null
  const status = parseStatus(payload.status)

  if (payload.ok !== true || !handledByUserId || !status) {
    return { ok: false, errorCode: 'UNKNOWN', errorMessage: REQUEST_OWNERSHIP_MESSAGES.UNKNOWN }
  }

  return {
    ok: true,
    handledByUserId,
    status,
    unchanged: payload.unchanged === true,
  }
}

export async function transferRequestHandler(
  requestId: string,
  targetUserId: string,
): Promise<TransferRequestHandlerResult> {
  const { data, error } = await supabase.rpc('transfer_request_handler', {
    p_request_id: requestId,
    p_target_user_id: targetUserId,
  })

  if (error || !data || typeof data !== 'object') {
    return { ok: false, ...failFromRpc(error, data) }
  }

  const payload = data as {
    ok?: unknown
    unchanged?: unknown
    handled_by_user_id?: unknown
    status?: unknown
    error?: unknown
  }

  if (payload.ok === false) {
    const errorCode = parseErrorCode(payload.error)
    return { ok: false, errorCode, errorMessage: REQUEST_OWNERSHIP_MESSAGES[errorCode] }
  }

  const handledByUserId =
    typeof payload.handled_by_user_id === 'string' ? payload.handled_by_user_id : null
  const status = parseStatus(payload.status)

  if (payload.ok !== true || !handledByUserId || !status) {
    return { ok: false, errorCode: 'UNKNOWN', errorMessage: REQUEST_OWNERSHIP_MESSAGES.UNKNOWN }
  }

  return {
    ok: true,
    handledByUserId,
    status,
    unchanged: payload.unchanged === true,
  }
}

export async function releaseRequestHandler(
  requestId: string,
): Promise<ReleaseRequestHandlerResult> {
  const { data, error } = await supabase.rpc('release_request_handler', {
    p_request_id: requestId,
  })

  if (error || !data || typeof data !== 'object') {
    return { ok: false, ...failFromRpc(error, data) }
  }

  const payload = data as {
    ok?: unknown
    handled_by_user_id?: unknown
    status?: unknown
    error?: unknown
  }

  if (payload.ok === false) {
    const errorCode = parseErrorCode(payload.error)
    return { ok: false, errorCode, errorMessage: REQUEST_OWNERSHIP_MESSAGES[errorCode] }
  }

  const status = parseStatus(payload.status)
  if (payload.ok !== true || !status) {
    return { ok: false, errorCode: 'UNKNOWN', errorMessage: REQUEST_OWNERSHIP_MESSAGES.UNKNOWN }
  }

  return { ok: true, handledByUserId: null, status }
}

export async function loadEligibleRequestHandlers(input: {
  requestType: RequestType
  recipientRole?: GeneralRequestRecipientRole | null
  excludeUserId?: string | null
  institutionId?: string | null
}): Promise<LoadEligibleRequestHandlersResult> {
  let query = supabase
    .from('users')
    .select('id, full_name, primary_role, status, institution_id')
    .in('primary_role', ['institution_manager', 'deputy', 'secretary'])
    .eq('status', 'active')

  if (input.institutionId) {
    query = query.eq('institution_id', input.institutionId)
  }

  const { data, error } = await query.order('full_name', { ascending: true })

  if (error) {
    console.error('[requestOwnership] failed to load eligible handlers', error)
    return { ok: false, errorMessage: 'לא ניתן לטעון את רשימת המטפלות.' }
  }

  const users: Array<{
    id: string
    fullName: string
    primaryRole: EligibleHandlerRole
    status: string
  }> = []

  for (const row of data ?? []) {
    if (
      typeof row.id !== 'string' ||
      typeof row.full_name !== 'string' ||
      !isEligibleHandlerRole(row.primary_role) ||
      typeof row.status !== 'string'
    ) {
      continue
    }

    if (input.institutionId && row.institution_id !== input.institutionId) {
      continue
    }

    users.push({
      id: row.id,
      fullName: row.full_name,
      primaryRole: row.primary_role,
      status: row.status,
    })
  }

  const handlers = filterEligibleHandlersForRequest({
    users,
    requestType: input.requestType,
    recipientRole: input.recipientRole,
    excludeUserId: input.excludeUserId,
  }).map(
    (user): RequestHandlerOption => ({
      id: user.id,
      fullName: user.fullName,
      primaryRole: user.primaryRole,
      status: user.status === 'inactive' ? 'inactive' : 'active',
    }),
  )

  return { ok: true, handlers }
}

function parseHistoryAction(value: unknown): HandlerHistoryAction | null {
  if (value === 'claim' || value === 'transfer' || value === 'release') {
    return value
  }
  return null
}

export async function loadRequestHandlerHistory(
  requestId: string,
): Promise<LoadRequestHandlerHistoryResult> {
  const { data, error } = await supabase
    .from('request_handler_history')
    .select(
      'id, action, created_at, actor_user_id, previous_handler_user_id, new_handler_user_id, actor:users!actor_user_id(full_name), previous_handler:users!previous_handler_user_id(full_name), new_handler:users!new_handler_user_id(full_name)',
    )
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[requestOwnership] failed to load handler history', error)
    return { ok: false, errorMessage: 'לא ניתן לטעון את היסטוריית הטיפול.' }
  }

  const entries: RequestHandlerHistoryEntry[] = []
  for (const row of data ?? []) {
    const action = parseHistoryAction(row.action)
    if (
      typeof row.id !== 'string' ||
      typeof row.created_at !== 'string' ||
      typeof row.actor_user_id !== 'string' ||
      !action
    ) {
      continue
    }

    entries.push({
      id: row.id,
      action,
      createdAt: row.created_at,
      actorUserId: row.actor_user_id,
      actorFullName: parseJoinedName(row.actor),
      previousHandlerUserId:
        typeof row.previous_handler_user_id === 'string' ? row.previous_handler_user_id : null,
      previousHandlerFullName: parseJoinedName(row.previous_handler),
      newHandlerUserId: typeof row.new_handler_user_id === 'string' ? row.new_handler_user_id : null,
      newHandlerFullName: parseJoinedName(row.new_handler),
    })
  }

  return { ok: true, entries }
}
