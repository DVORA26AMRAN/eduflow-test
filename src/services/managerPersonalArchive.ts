import type { ManagerPersonalArchivedRequest } from '../types/managerPersonalArchive'
import { isRequestStatus, isRequestType } from '../utils/requests'
import { supabase } from './supabase'

export type ArchiveRequestForManagerResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type LoadManagerPersonalArchivedRequestsParams = {
  dateFrom?: string
  dateTo?: string
  page: number
  pageSize: number
}

export type LoadManagerPersonalArchivedRequestsResult =
  | { ok: true; requests: ManagerPersonalArchivedRequest[]; totalCount: number }
  | { ok: false; errorMessage: string }

export type LoadManagerPersonalArchivedRequestIdsResult =
  | { ok: true; requestIds: string[] }
  | { ok: false; errorMessage: string }

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

function normalizeJoinedRequest(requests: unknown): {
  id: unknown
  request_type: unknown
  status: unknown
  created_at: unknown
  users: unknown
} | null {
  if (Array.isArray(requests)) {
    const first = requests[0]
    return first && typeof first === 'object'
      ? (first as {
          id: unknown
          request_type: unknown
          status: unknown
          created_at: unknown
          users: unknown
        })
      : null
  }

  if (requests && typeof requests === 'object') {
    return requests as {
      id: unknown
      request_type: unknown
      status: unknown
      created_at: unknown
      users: unknown
    }
  }

  return null
}

function parseManagerPersonalArchivedRequest(row: {
  archived_at: unknown
  requests: unknown
}): ManagerPersonalArchivedRequest | null {
  const request = normalizeJoinedRequest(row.requests)
  const teacherFullName = request ? extractTeacherFullName(request.users) : null

  if (
    !request ||
    typeof row.archived_at !== 'string' ||
    typeof request.id !== 'string' ||
    typeof request.created_at !== 'string' ||
    typeof request.request_type !== 'string' ||
    typeof request.status !== 'string' ||
    teacherFullName === null ||
    !isRequestType(request.request_type) ||
    !isRequestStatus(request.status)
  ) {
    return null
  }

  return {
    id: request.id,
    request_type: request.request_type,
    status: request.status,
    created_at: request.created_at,
    archived_at: row.archived_at,
    teacher_full_name: teacherFullName,
  }
}

export async function loadManagerPersonalArchivedRequestIds(): Promise<LoadManagerPersonalArchivedRequestIdsResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[managerPersonalArchive] no authenticated session', sessionError)
    return {
      ok: false,
      errorMessage: 'לא ניתן לטעון את הארכיון האישי.',
    }
  }

  const { data, error } = await supabase
    .from('manager_archived_requests')
    .select('request_id')
    .eq('manager_user_id', sessionData.session.user.id)

  if (error) {
    console.error('[managerPersonalArchive] failed to load personal archive ids', error)
    return {
      ok: false,
      errorMessage: 'לא ניתן לטעון את הארכיון האישי.',
    }
  }

  const requestIds = (data ?? [])
    .map((row) => row.request_id)
    .filter((requestId): requestId is string => typeof requestId === 'string')

  return { ok: true, requestIds }
}

export async function archiveRequestForManager(
  requestId: string,
): Promise<ArchiveRequestForManagerResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[managerPersonalArchive] no authenticated session for archive', sessionError)
    return {
      ok: false,
      errorMessage: 'לא ניתן להעביר את הבקשה לארכיון כרגע.',
    }
  }

  const managerUserId = sessionData.session.user.id
  const archivedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('manager_archived_requests')
    .insert({
      manager_user_id: managerUserId,
      request_id: requestId,
      archived_at: archivedAt,
    })
    .select('manager_user_id, request_id')

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        errorMessage: 'הבקשה כבר נמצאת בארכיון האישי שלך.',
      }
    }

    console.error('[managerPersonalArchive] failed to archive request personally', error)
    return {
      ok: false,
      errorMessage: 'העברת הבקשה לארכיון נכשלה.',
    }
  }

  if (!data || data.length !== 1) {
    return {
      ok: false,
      errorMessage: 'לא ניתן להעביר בקשה זו לארכיון.',
    }
  }

  return { ok: true }
}

export async function loadManagerPersonalArchivedRequests(
  params: LoadManagerPersonalArchivedRequestsParams,
): Promise<LoadManagerPersonalArchivedRequestsResult> {
  const page = Math.max(1, params.page)
  const pageSize = Math.max(1, params.pageSize)
  const rangeFrom = (page - 1) * pageSize
  const rangeTo = rangeFrom + pageSize - 1

  let query = supabase
    .from('manager_archived_requests')
    .select(
      `
        archived_at,
        requests!inner (
          id,
          request_type,
          status,
          created_at,
          users!created_by_user_id (full_name)
        )
      `,
      { count: 'exact' },
    )
    .order('archived_at', { ascending: false })

  if (params.dateFrom) {
    query = query.gte('archived_at', `${params.dateFrom}T00:00:00`)
  }

  if (params.dateTo) {
    query = query.lte('archived_at', `${params.dateTo}T23:59:59.999`)
  }

  const { data, error, count } = await query.range(rangeFrom, rangeTo)

  if (error) {
    console.error('[managerPersonalArchive] failed to load personal archive', error)
    return {
      ok: false,
      errorMessage: 'לא ניתן לטעון את הארכיון האישי.',
    }
  }

  const requests = (data ?? [])
    .map((row) => parseManagerPersonalArchivedRequest(row))
    .filter((request): request is ManagerPersonalArchivedRequest => request !== null)

  return { ok: true, requests, totalCount: count ?? 0 }
}
