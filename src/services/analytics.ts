import type { ManagerAnalytics } from '../types/analytics'
import { isRequestStatus } from '../utils/requests'
import { supabase } from './supabase'

export type LoadManagerAnalyticsResult =
  | { ok: true; analytics: ManagerAnalytics }
  | { ok: false; errorMessage: string }

function createEmptyAnalytics(): ManagerAnalytics {
  return {
    activeTeachersCount: 0,
    activeSecretariesCount: 0,
    totalRequestsCount: 0,
    newRequestsCount: 0,
    inProgressRequestsCount: 0,
    completedRequestsCount: 0,
    rejectedRequestsCount: 0,
  }
}

export async function loadManagerAnalytics(): Promise<LoadManagerAnalyticsResult> {
  const [usersResult, requestsResult] = await Promise.all([
    supabase.from('users').select('primary_role, status'),
    supabase.from('requests').select('status'),
  ])

  if (usersResult.error) {
    console.error('[analytics] failed to load users', usersResult.error)
    return {
      ok: false,
      errorMessage: 'טעינת הנתונים נכשלה.',
    }
  }

  if (requestsResult.error) {
    console.error('[analytics] failed to load requests', requestsResult.error)
    return {
      ok: false,
      errorMessage: 'טעינת הנתונים נכשלה.',
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
  }

  return { ok: true, analytics }
}
