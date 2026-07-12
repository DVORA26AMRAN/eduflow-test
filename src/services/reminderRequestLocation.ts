import type { ReminderRequestLocation } from '../types/reminderNavigation'
import { loadManagerPersonalArchivedRequestIds } from './managerPersonalArchive'
import { supabase } from './supabase'

export const INSTITUTIONAL_ARCHIVE_PAGE_SIZE = 20

export const MANAGER_PERSONAL_ARCHIVE_PAGE_SIZE = 20

async function getAuthenticatedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession()

  if (error || !data.session?.user) {
    return null
  }

  return data.session.user.id
}

async function getSecretaryInstitutionalArchivePageForRequest(
  requestId: string,
  pageSize: number,
): Promise<number> {
  const { data: requestRow, error: requestError } = await supabase
    .from('requests')
    .select('archived_at')
    .eq('id', requestId)
    .not('archived_at', 'is', null)
    .maybeSingle()

  if (requestError || !requestRow?.archived_at) {
    return 1
  }

  const { count, error: countError } = await supabase
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .not('archived_at', 'is', null)
    .gt('archived_at', requestRow.archived_at)

  if (countError) {
    return 1
  }

  return Math.floor((count ?? 0) / pageSize) + 1
}

async function getManagerPersonalArchivePageForRequest(
  requestId: string,
  pageSize: number,
): Promise<number> {
  const userId = await getAuthenticatedUserId()
  if (!userId) {
    return 1
  }

  const { data: archiveRow, error: archiveError } = await supabase
    .from('manager_archived_requests')
    .select('archived_at')
    .eq('manager_user_id', userId)
    .eq('request_id', requestId)
    .maybeSingle()

  if (archiveError || !archiveRow?.archived_at) {
    return 1
  }

  const { count, error: countError } = await supabase
    .from('manager_archived_requests')
    .select('request_id', { count: 'exact', head: true })
    .eq('manager_user_id', userId)
    .gt('archived_at', archiveRow.archived_at)

  if (countError) {
    return 1
  }

  return Math.floor((count ?? 0) / pageSize) + 1
}

export async function resolveSecretaryReminderRequestLocation(
  requestId: string,
): Promise<ReminderRequestLocation> {
  const { data, error } = await supabase
    .from('requests')
    .select('archived_at')
    .eq('id', requestId)
    .maybeSingle()

  if (error || !data) {
    return { kind: 'not_found' }
  }

  if (data.archived_at === null) {
    return { kind: 'secretary_inbox' }
  }

  const page = await getSecretaryInstitutionalArchivePageForRequest(
    requestId,
    INSTITUTIONAL_ARCHIVE_PAGE_SIZE,
  )

  return { kind: 'secretary_institutional_archive', page }
}

export async function resolveManagerReminderRequestLocation(
  requestId: string,
): Promise<ReminderRequestLocation> {
  const archivedIdsResult = await loadManagerPersonalArchivedRequestIds()

  if (!archivedIdsResult.ok) {
    return { kind: 'not_found' }
  }

  if (archivedIdsResult.requestIds.includes(requestId)) {
    const page = await getManagerPersonalArchivePageForRequest(
      requestId,
      MANAGER_PERSONAL_ARCHIVE_PAGE_SIZE,
    )

    return { kind: 'manager_personal_archive', page }
  }

  return { kind: 'manager_recent' }
}
