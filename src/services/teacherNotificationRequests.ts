import type { RequestPayload, RequestStatus, RequestType } from '../types/request'
import type { TeacherRequestNotificationContext } from '../types/teacherNotification'
import { supabase } from './supabase'

export type LoadTeacherRequestNotificationContextsResult =
  | { ok: true; contexts: Map<string, TeacherRequestNotificationContext> }
  | { ok: false; errorMessage: string }

function parseRequestType(value: unknown): RequestType | null {
  if (
    value === 'absence' ||
    value === 'budget_or_equipment' ||
    value === 'substitute_teacher' ||
    value === 'general_request'
  ) {
    return value
  }

  return null
}

function parseRequestStatus(value: unknown): RequestStatus | null {
  if (
    value === 'new' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'rejected'
  ) {
    return value
  }

  return null
}

function parseRequestPayload(value: unknown): RequestPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as RequestPayload
}

function parseTeacherRequestNotificationContext(row: {
  id: unknown
  request_type: unknown
  description: unknown
  status: unknown
  archived_at: unknown
  request_payload: unknown
}): TeacherRequestNotificationContext | null {
  const requestType = parseRequestType(row.request_type)
  const status = parseRequestStatus(row.status)

  if (typeof row.id !== 'string' || !requestType || !status || typeof row.description !== 'string') {
    return null
  }

  return {
    requestId: row.id,
    requestType,
    description: row.description,
    status,
    archivedAt: typeof row.archived_at === 'string' ? row.archived_at : null,
    requestPayload: parseRequestPayload(row.request_payload),
  }
}

export async function loadTeacherRequestNotificationContexts(
  requestIds: string[],
): Promise<LoadTeacherRequestNotificationContextsResult> {
  if (requestIds.length === 0) {
    return { ok: true, contexts: new Map() }
  }

  const { data, error } = await supabase
    .from('requests')
    .select('id, request_type, description, status, archived_at, request_payload')
    .in('id', requestIds)

  if (error) {
    console.error('[teacherNotificationRequests] failed to load request contexts', error)
    return {
      ok: false,
      errorMessage: 'טעינת פרטי הבקשות להתראות נכשלה.',
    }
  }

  const contexts = new Map<string, TeacherRequestNotificationContext>()

  for (const row of data ?? []) {
    const context = parseTeacherRequestNotificationContext(row)
    if (context) {
      contexts.set(context.requestId, context)
    }
  }

  return { ok: true, contexts }
}
