import type {
  ManagerAnalytics,
  ManagerRecentActivityEntry,
  ManagerRecentRequest,
} from '../types/analytics'
import type { RequestPayload } from '../types/request'
import { isRequestStatus, isRequestType } from '../utils/requests'
import { loadManagerPersonalArchivedRequestIds } from './managerPersonalArchive'
import { supabase } from './supabase'

export type LoadManagerAnalyticsResult =
  | { ok: true; analytics: ManagerAnalytics }
  | { ok: false; errorMessage: string }

export type LoadRecentRequestsResult =
  | { ok: true; requests: ManagerRecentRequest[] }
  | { ok: false; errorMessage: string }

export type LoadRecentRequestActivityResult =
  | { ok: true; entries: ManagerRecentActivityEntry[] }
  | { ok: false; errorMessage: string }

const ANALYTICS_ERROR_MESSAGE = 'טעינת הנתונים נכשלה.'

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

function parseRequestPayload(value: unknown): RequestPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as RequestPayload
}

function parseManagerRecentRequest(row: {
  id: unknown
  request_type: unknown
  description: unknown
  status: unknown
  created_at: unknown
  users: unknown
  request_payload?: unknown
}): ManagerRecentRequest | null {
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
    teacher_full_name: teacherFullName,
    request_type: row.request_type,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    request_payload: parseRequestPayload(row.request_payload),
  }
}

function parseManagerRecentActivityEntry(row: {
  id: unknown
  previous_status: unknown
  new_status: unknown
  created_at: unknown
}): ManagerRecentActivityEntry | null {
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
  }
}

function createEmptyAnalytics(): ManagerAnalytics {
  return {
    activeTeachersCount: 0,
    activeSecretariesCount: 0,
    totalRequestsCount: 0,
    newRequestsCount: 0,
    inProgressRequestsCount: 0,
    completedRequestsCount: 0,
    rejectedRequestsCount: 0,
    requestTypeCounts: {
      absence: 0,
      budget_or_equipment: 0,
      substitute_teacher: 0,
      general_request: 0,
    },
  }
}

export async function loadManagerAnalytics(): Promise<LoadManagerAnalyticsResult> {
  const [usersResult, requestsResult] = await Promise.all([
    supabase.from('users').select('primary_role, status'),
    supabase.from('requests').select('status, request_type'),
  ])

  if (usersResult.error) {
    console.error('[analytics] failed to load users', usersResult.error)
    return {
      ok: false,
      errorMessage: ANALYTICS_ERROR_MESSAGE,
    }
  }

  if (requestsResult.error) {
    console.error('[analytics] failed to load requests', requestsResult.error)
    return {
      ok: false,
      errorMessage: ANALYTICS_ERROR_MESSAGE,
    }
  }

  const analytics = createEmptyAnalytics()

  for (const user of usersResult.data ?? []) {
    if (user.status !== 'active') {
      continue
    }

    if (user.primary_role === 'teacher') {
      analytics.activeTeachersCount += 1
    }

    if (user.primary_role === 'secretary') {
      analytics.activeSecretariesCount += 1
    }
  }

  for (const request of requestsResult.data ?? []) {
    if (!isRequestStatus(request.status)) {
      continue
    }

    analytics.totalRequestsCount += 1

    switch (request.status) {
      case 'new':
        analytics.newRequestsCount += 1
        break
      case 'in_progress':
        analytics.inProgressRequestsCount += 1
        break
      case 'completed':
        analytics.completedRequestsCount += 1
        break
      case 'rejected':
        analytics.rejectedRequestsCount += 1
        break
    }

    if (isRequestType(request.request_type)) {
      analytics.requestTypeCounts[request.request_type] += 1
    }
  }

  return { ok: true, analytics }
}

export async function loadRecentRequests(): Promise<LoadRecentRequestsResult> {
  const personalArchiveIdsResult = await loadManagerPersonalArchivedRequestIds()

  if (!personalArchiveIdsResult.ok) {
    return {
      ok: false,
      errorMessage: personalArchiveIdsResult.errorMessage,
    }
  }

  let query = supabase
    .from('requests')
    .select(
      'id, request_type, description, status, created_at, request_payload, users!created_by_user_id(full_name)',
    )
    .order('created_at', { ascending: false })
    .limit(5)

  const personalArchiveIds = personalArchiveIdsResult.requestIds
  if (personalArchiveIds.length > 0) {
    query = query.not(
      'id',
      'in',
      `(${personalArchiveIds.map((requestId) => `"${requestId}"`).join(',')})`,
    )
  }

  const { data, error } = await query

  if (error) {
    console.error('[analytics] failed to load recent requests', error)
    return {
      ok: false,
      errorMessage: ANALYTICS_ERROR_MESSAGE,
    }
  }

  const requests = (data ?? [])
    .map(parseManagerRecentRequest)
    .filter((request): request is ManagerRecentRequest => request !== null)

  return { ok: true, requests }
}

export async function loadRecentRequestActivity(): Promise<LoadRecentRequestActivityResult> {
  const { data, error } = await supabase
    .from('request_status_history')
    .select('id, previous_status, new_status, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('[analytics] failed to load recent request activity', error)
    return {
      ok: false,
      errorMessage: ANALYTICS_ERROR_MESSAGE,
    }
  }

  const entries = (data ?? [])
    .map(parseManagerRecentActivityEntry)
    .filter((entry): entry is ManagerRecentActivityEntry => entry !== null)

  return { ok: true, entries }
}
