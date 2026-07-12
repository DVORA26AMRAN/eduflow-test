import type {
  DashboardDateRange,
  ManagerDashboardAnalytics,
  SecretaryDashboardAnalytics,
  TeacherDashboardAnalytics,
  DashboardAttentionItem,
} from '../types/dashboardAnalytics'
import type { RequestStatus, RequestType } from '../types/request'
import type { RequestReminderSummary } from '../types/requestReminder'
import { canSendRequestReminder } from '../services/requestReminders'
import {
  aggregateStatusCounts,
  aggregateTypeCounts,
  buildCompletionRateTrend,
  buildProcessingTimeTrend,
  buildSubmissionTrend,
  buildWorkloadAging,
  calculateAverageProcessingTimeHours,
  calculateCompletionRate,
  createEmptyTypeCounts,
  filterSecretaryAnalyticsRequests,
  findLongestAwaitingHours,
  isWithinDateRange,
  type AnalyticsRequestRow,
  type AnalyticsResolutionRow,
} from '../utils/dashboardAnalytics'
import { isRequestStatus, isRequestType } from '../utils/requests'
import { supabase } from './supabase'

const ANALYTICS_ERROR_MESSAGE = 'טעינת הנתונים נכשלה.'

export type LoadDashboardAnalyticsResult<T> =
  | { ok: true; analytics: T }
  | { ok: false; errorMessage: string }

type RawRequestRow = {
  id: unknown
  request_type: unknown
  status: unknown
  created_at: unknown
  description?: unknown
  recipient_role?: unknown
  users?: unknown
}

type RawResolutionRow = {
  request_id: unknown
  new_status: unknown
  created_at: unknown
}

function extractTeacherFullName(users: unknown): string | undefined {
  if (Array.isArray(users)) {
    const first = users[0] as { full_name?: unknown } | undefined
    return typeof first?.full_name === 'string' ? first.full_name : undefined
  }

  if (users && typeof users === 'object' && 'full_name' in users) {
    const fullName = (users as { full_name: unknown }).full_name
    return typeof fullName === 'string' ? fullName : undefined
  }

  return undefined
}

function parseAnalyticsRequestRow(row: RawRequestRow): AnalyticsRequestRow | null {
  if (
    typeof row.id !== 'string' ||
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
    status: row.status,
    created_at: row.created_at,
    description: typeof row.description === 'string' ? row.description : undefined,
    recipient_role: typeof row.recipient_role === 'string' ? row.recipient_role : null,
    teacher_full_name: extractTeacherFullName(row.users),
  }
}

function parseResolutionRow(row: RawResolutionRow): AnalyticsResolutionRow | null {
  if (
    typeof row.request_id !== 'string' ||
    typeof row.created_at !== 'string' ||
    (row.new_status !== 'completed' && row.new_status !== 'rejected')
  ) {
    return null
  }

  return {
    request_id: row.request_id,
    resolved_at: row.created_at,
    new_status: row.new_status,
  }
}

async function loadAnalyticsRequests(options: {
  includeTeacherName?: boolean
  includeRecipientRole?: boolean
  activeOnly?: boolean
  dateRange?: DashboardDateRange
}): Promise<LoadDashboardAnalyticsResult<AnalyticsRequestRow[]>> {
  const columns = [
    'id',
    'request_type',
    'status',
    'created_at',
    'description',
    ...(options.includeRecipientRole ? ['recipient_role'] : []),
    ...(options.includeTeacherName
      ? ['users!created_by_user_id(full_name)']
      : []),
  ].join(', ')

  let query = supabase.from('requests').select(columns)

  if (options.activeOnly) {
    query = query.is('archived_at', null)
  }

  if (options.dateRange) {
    query = query
      .gte('created_at', options.dateRange.startAt)
      .lte('created_at', options.dateRange.endAt)
  }

  const { data, error } = await query

  if (error) {
    console.error('[dashboardAnalytics] failed to load requests', error)
    return { ok: false, errorMessage: ANALYTICS_ERROR_MESSAGE }
  }

  const requests = (data ?? [])
    .map((row) => parseAnalyticsRequestRow(row as unknown as RawRequestRow))
    .filter((request): request is AnalyticsRequestRow => request !== null)

  return { ok: true, analytics: requests }
}

async function loadResolutionRows(
  dateRange: DashboardDateRange,
): Promise<LoadDashboardAnalyticsResult<AnalyticsResolutionRow[]>> {
  const { data, error } = await supabase
    .from('request_status_history')
    .select('request_id, new_status, created_at')
    .in('new_status', ['completed', 'rejected'])
    .gte('created_at', dateRange.startAt)
    .lte('created_at', dateRange.endAt)

  if (error) {
    console.error('[dashboardAnalytics] failed to load status history', error)
    return { ok: false, errorMessage: ANALYTICS_ERROR_MESSAGE }
  }

  const resolutions = (data ?? [])
    .map((row) => parseResolutionRow(row as RawResolutionRow))
    .filter((row): row is AnalyticsResolutionRow => row !== null)

  return { ok: true, analytics: resolutions }
}

function toAttentionItem(
  request: AnalyticsRequestRow,
  extras?: Partial<DashboardAttentionItem>,
): DashboardAttentionItem {
  return {
    id: request.id,
    requestType: request.request_type,
    description: request.description ?? '',
    status: request.status,
    createdAt: request.created_at,
    teacherFullName: request.teacher_full_name,
    ...extras,
  }
}

function buildRequestsById(requests: readonly AnalyticsRequestRow[]): Map<string, AnalyticsRequestRow> {
  return new Map(requests.map((request) => [request.id, request]))
}

function countResolutionsInPeriod(
  resolutions: readonly AnalyticsResolutionRow[],
  range: DashboardDateRange,
  status: Extract<RequestStatus, 'completed' | 'rejected'>,
): number {
  return resolutions.filter(
    (resolution) =>
      resolution.new_status === status && isWithinDateRange(resolution.resolved_at, range),
  ).length
}

function buildTypeBacklog(requests: readonly AnalyticsRequestRow[]) {
  const active = requests.filter(
    (request) => request.status === 'new' || request.status === 'in_progress',
  )
  const counts = createEmptyTypeCounts()

  for (const request of active) {
    counts[request.request_type] += 1
  }

  return (Object.keys(counts) as RequestType[])
    .map((requestType) => ({
      requestType,
      activeCount: counts[requestType],
    }))
    .filter((entry) => entry.activeCount > 0)
    .sort((a, b) => b.activeCount - a.activeCount)
}

export async function loadTeacherDashboardAnalytics(
  dateRange: DashboardDateRange,
): Promise<LoadDashboardAnalyticsResult<TeacherDashboardAnalytics>> {
  const requestsResult = await loadAnalyticsRequests({ dateRange })

  if (!requestsResult.ok) {
    return requestsResult
  }

  const requests = requestsResult.analytics
  const inRangeRequests = requests.filter((request) => isWithinDateRange(request.created_at, dateRange))
  const statusCounts = aggregateStatusCounts(inRangeRequests)

  const followUpRequests = requests
    .filter(
      (request) =>
        (request.status === 'new' || request.status === 'in_progress') &&
        canSendRequestReminder(request.status),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, 5)
    .map((request) => toAttentionItem(request))

  return {
    ok: true,
    analytics: {
      totalSubmitted: inRangeRequests.length,
      statusCounts,
      typeCounts: aggregateTypeCounts(inRangeRequests),
      trend: buildSubmissionTrend(requests, dateRange),
      followUpRequests,
      longestAwaitingHours: findLongestAwaitingHours(requests),
    },
  }
}

export async function loadSecretaryDashboardAnalytics(
  dateRange: DashboardDateRange,
  unreadReminderRequestIds: ReadonlySet<string>,
  reminderSummariesByRequestId: ReadonlyMap<string, RequestReminderSummary>,
): Promise<LoadDashboardAnalyticsResult<SecretaryDashboardAnalytics>> {
  const [activeResult, periodResult, resolutionsResult] = await Promise.all([
    loadAnalyticsRequests({
      includeTeacherName: true,
      includeRecipientRole: true,
      activeOnly: true,
    }),
    loadAnalyticsRequests({
      includeTeacherName: true,
      includeRecipientRole: true,
      dateRange,
    }),
    loadResolutionRows(dateRange),
  ])

  if (!activeResult.ok) {
    return activeResult
  }

  if (!periodResult.ok) {
    return periodResult
  }

  if (!resolutionsResult.ok) {
    return resolutionsResult
  }

  const activeRequests = filterSecretaryAnalyticsRequests(activeResult.analytics)
  const periodRequests = filterSecretaryAnalyticsRequests(periodResult.analytics)
  const activeStatusCounts = aggregateStatusCounts(activeRequests)
  const requestsById = buildRequestsById([...activeRequests, ...periodRequests])
  const resolutions = resolutionsResult.analytics.filter((resolution) =>
    requestsById.has(resolution.request_id),
  )

  const attentionCandidates = activeRequests
    .map((request) =>
      toAttentionItem(request, {
        hasUnreadReminder: unreadReminderRequestIds.has(request.id),
        reminderCount: reminderSummariesByRequestId.get(request.id)?.reminder_count,
      }),
    )
    .sort((a, b) => {
      if (Boolean(a.hasUnreadReminder) !== Boolean(b.hasUnreadReminder)) {
        return a.hasUnreadReminder ? -1 : 1
      }

      return a.createdAt.localeCompare(b.createdAt)
    })
    .slice(0, 8)

  return {
    ok: true,
    analytics: {
      activeRequests: activeRequests.length,
      statusCounts: aggregateStatusCounts(periodRequests),
      activeWorkloadCounts: {
        new: activeStatusCounts.new,
        in_progress: activeStatusCounts.in_progress,
      },
      completedInPeriod: countResolutionsInPeriod(resolutions, dateRange, 'completed'),
      rejectedInPeriod: countResolutionsInPeriod(resolutions, dateRange, 'rejected'),
      unreadReminderCount: unreadReminderRequestIds.size,
      typeCounts: aggregateTypeCounts(periodRequests),
      trend: buildSubmissionTrend(periodRequests, dateRange),
      processingTimeTrend: buildProcessingTimeTrend(requestsById, resolutions, dateRange),
      averageProcessingHours: calculateAverageProcessingTimeHours(
        requestsById,
        resolutions,
        dateRange,
      ),
      attentionRequests: attentionCandidates,
      workloadAging: buildWorkloadAging(activeRequests),
    },
  }
}

export async function loadManagerDashboardAnalytics(
  dateRange: DashboardDateRange,
  reminderSummariesByRequestId: ReadonlyMap<string, RequestReminderSummary>,
): Promise<LoadDashboardAnalyticsResult<ManagerDashboardAnalytics>> {
  const [allRequestsResult, periodRequestsResult, resolutionsResult] = await Promise.all([
    loadAnalyticsRequests({
      includeTeacherName: true,
      includeRecipientRole: true,
    }),
    loadAnalyticsRequests({
      includeTeacherName: true,
      includeRecipientRole: true,
      dateRange,
    }),
    loadResolutionRows(dateRange),
  ])

  if (!allRequestsResult.ok) {
    return allRequestsResult
  }

  if (!periodRequestsResult.ok) {
    return periodRequestsResult
  }

  if (!resolutionsResult.ok) {
    return resolutionsResult
  }

  const allRequests = allRequestsResult.analytics
  const periodRequests = periodRequestsResult.analytics
  const requestsById = buildRequestsById(allRequests)
  const resolutions = resolutionsResult.analytics.filter((resolution) =>
    requestsById.has(resolution.request_id),
  )
  const statusCounts = aggregateStatusCounts(allRequests)
  const activeRequests = allRequests.filter(
    (request) => request.status === 'new' || request.status === 'in_progress',
  )

  const generalRequestRouting = {
    secretary: allRequests.filter(
      (request) =>
        request.request_type === 'general_request' && request.recipient_role === 'secretary',
    ).length,
    institution_manager: allRequests.filter(
      (request) =>
        request.request_type === 'general_request' &&
        request.recipient_role === 'institution_manager',
    ).length,
  }

  const attentionRequests = activeRequests
    .map((request) =>
      toAttentionItem(request, {
        teacherFullName: request.teacher_full_name,
        reminderCount: reminderSummariesByRequestId.get(request.id)?.reminder_count ?? 0,
      }),
    )
    .sort((a, b) => {
      const reminderDiff = (b.reminderCount ?? 0) - (a.reminderCount ?? 0)
      if (reminderDiff !== 0) {
        return reminderDiff
      }

      return a.createdAt.localeCompare(b.createdAt)
    })
    .slice(0, 8)

  return {
    ok: true,
    analytics: {
      totalInstitutionRequests: allRequests.length,
      activeRequests: activeRequests.length,
      statusCounts,
      completionRate: calculateCompletionRate(resolutions, dateRange),
      requestsWithReminders: reminderSummariesByRequestId.size,
      typeCounts: aggregateTypeCounts(periodRequests),
      trend: buildSubmissionTrend(periodRequests, dateRange),
      completionTrend: buildCompletionRateTrend(resolutions, dateRange),
      averageProcessingHours: calculateAverageProcessingTimeHours(
        requestsById,
        resolutions,
        dateRange,
      ),
      processingTimeTrend: buildProcessingTimeTrend(requestsById, resolutions, dateRange),
      generalRequestRouting,
      attentionRequests,
      typeBacklog: buildTypeBacklog(allRequests),
    },
  }
}

export function buildTeacherDashboardAnalyticsFromRequests(
  requests: readonly AnalyticsRequestRow[],
  dateRange: DashboardDateRange,
): TeacherDashboardAnalytics {
  const inRangeRequests = requests.filter((request) => isWithinDateRange(request.created_at, dateRange))

  return {
    totalSubmitted: inRangeRequests.length,
    statusCounts: aggregateStatusCounts(inRangeRequests),
    typeCounts: aggregateTypeCounts(inRangeRequests),
    trend: buildSubmissionTrend(requests, dateRange),
    followUpRequests: requests
      .filter(
        (request) =>
          (request.status === 'new' || request.status === 'in_progress') &&
          canSendRequestReminder(request.status),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, 5)
      .map((request) => toAttentionItem(request)),
    longestAwaitingHours: findLongestAwaitingHours(requests),
  }
}

export function buildSecretaryDashboardAnalyticsFromRequests(
  activeRequests: readonly AnalyticsRequestRow[],
  periodRequests: readonly AnalyticsRequestRow[],
  resolutions: readonly AnalyticsResolutionRow[],
  dateRange: DashboardDateRange,
  unreadReminderRequestIds: ReadonlySet<string>,
  reminderSummariesByRequestId: ReadonlyMap<string, RequestReminderSummary>,
): SecretaryDashboardAnalytics {
  const filteredActive = filterSecretaryAnalyticsRequests(activeRequests)
  const filteredPeriod = filterSecretaryAnalyticsRequests(periodRequests)
  const activeStatusCounts = aggregateStatusCounts(filteredActive)
  const requestsById = buildRequestsById([...filteredActive, ...filteredPeriod])
  const filteredResolutions = resolutions.filter((resolution) => requestsById.has(resolution.request_id))

  return {
    activeRequests: filteredActive.length,
    statusCounts: aggregateStatusCounts(filteredPeriod),
    activeWorkloadCounts: {
      new: activeStatusCounts.new,
      in_progress: activeStatusCounts.in_progress,
    },
    completedInPeriod: countResolutionsInPeriod(filteredResolutions, dateRange, 'completed'),
    rejectedInPeriod: countResolutionsInPeriod(filteredResolutions, dateRange, 'rejected'),
    unreadReminderCount: unreadReminderRequestIds.size,
    typeCounts: aggregateTypeCounts(filteredPeriod),
    trend: buildSubmissionTrend(filteredPeriod, dateRange),
    processingTimeTrend: buildProcessingTimeTrend(requestsById, filteredResolutions, dateRange),
    averageProcessingHours: calculateAverageProcessingTimeHours(
      requestsById,
      filteredResolutions,
      dateRange,
    ),
    attentionRequests: filteredActive
      .map((request) =>
        toAttentionItem(request, {
          hasUnreadReminder: unreadReminderRequestIds.has(request.id),
          reminderCount: reminderSummariesByRequestId.get(request.id)?.reminder_count,
        }),
      )
      .sort((a, b) => {
        if (Boolean(a.hasUnreadReminder) !== Boolean(b.hasUnreadReminder)) {
          return a.hasUnreadReminder ? -1 : 1
        }

        return a.createdAt.localeCompare(b.createdAt)
      })
      .slice(0, 8),
    workloadAging: buildWorkloadAging(filteredActive),
  }
}

export function buildManagerDashboardAnalyticsFromRequests(
  allRequests: readonly AnalyticsRequestRow[],
  periodRequests: readonly AnalyticsRequestRow[],
  resolutions: readonly AnalyticsResolutionRow[],
  dateRange: DashboardDateRange,
  reminderSummariesByRequestId: ReadonlyMap<string, RequestReminderSummary>,
): ManagerDashboardAnalytics {
  const requestsById = buildRequestsById(allRequests)
  const filteredResolutions = resolutions.filter((resolution) => requestsById.has(resolution.request_id))
  const activeRequests = allRequests.filter(
    (request) => request.status === 'new' || request.status === 'in_progress',
  )

  return {
    totalInstitutionRequests: allRequests.length,
    activeRequests: activeRequests.length,
    statusCounts: aggregateStatusCounts(allRequests),
    completionRate: calculateCompletionRate(filteredResolutions, dateRange),
    requestsWithReminders: reminderSummariesByRequestId.size,
    typeCounts: aggregateTypeCounts(periodRequests),
    trend: buildSubmissionTrend(periodRequests, dateRange),
    completionTrend: buildCompletionRateTrend(filteredResolutions, dateRange),
    averageProcessingHours: calculateAverageProcessingTimeHours(
      requestsById,
      filteredResolutions,
      dateRange,
    ),
    processingTimeTrend: buildProcessingTimeTrend(requestsById, filteredResolutions, dateRange),
    generalRequestRouting: {
      secretary: allRequests.filter(
        (request) =>
          request.request_type === 'general_request' && request.recipient_role === 'secretary',
      ).length,
      institution_manager: allRequests.filter(
        (request) =>
          request.request_type === 'general_request' &&
          request.recipient_role === 'institution_manager',
      ).length,
    },
    attentionRequests: activeRequests
      .map((request) =>
        toAttentionItem(request, {
          teacherFullName: request.teacher_full_name,
          reminderCount: reminderSummariesByRequestId.get(request.id)?.reminder_count ?? 0,
        }),
      )
      .sort((a, b) => {
        const reminderDiff = (b.reminderCount ?? 0) - (a.reminderCount ?? 0)
        if (reminderDiff !== 0) {
          return reminderDiff
        }

        return a.createdAt.localeCompare(b.createdAt)
      })
      .slice(0, 8),
    typeBacklog: buildTypeBacklog(allRequests),
  }
}
