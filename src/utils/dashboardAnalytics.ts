import type { RequestStatus, RequestType } from '../types/request'
import type {
  CompletionRatePoint,
  DashboardDateRange,
  DashboardDateRangePreset,
  ProcessingTimePoint,
  RequestTypeCountMap,
  StatusCountMap,
  TimeSeriesPoint,
  WorkloadAgingBucket,
  WorkloadAgingBucketId,
} from '../types/dashboardAnalytics'

/**
 * Analytics date bucketing uses the browser local timezone.
 * There is no institution-specific timezone setting in the product yet.
 */
export const ANALYTICS_TIMEZONE_NOTE =
  'תאריכים מקובצים לפי אזור הזמן המקומי של הדפדפן.'

export const SCHOOL_YEAR_START_MONTH = 8 // September (0-indexed)

export type AnalyticsRequestRow = {
  id: string
  request_type: RequestType
  status: RequestStatus
  created_at: string
  description?: string
  recipient_role?: string | null
  teacher_full_name?: string
}

export type AnalyticsResolutionRow = {
  request_id: string
  resolved_at: string
  new_status: Extract<RequestStatus, 'completed' | 'rejected'>
}

export function createEmptyStatusCounts(): StatusCountMap {
  return {
    new: 0,
    in_progress: 0,
    completed: 0,
    rejected: 0,
  }
}

export function createEmptyTypeCounts(): RequestTypeCountMap {
  return {
    absence: 0,
    budget_or_equipment: 0,
    substitute_teacher: 0,
    general_request: 0,
  }
}

export function resolveDashboardDateRange(
  preset: DashboardDateRangePreset,
  referenceDate: Date = new Date(),
): DashboardDateRange {
  const endAt = endOfLocalDay(referenceDate)

  if (preset === 'school_year') {
    const schoolYearStart = getSchoolYearStart(referenceDate)
    return {
      preset,
      startAt: startOfLocalDay(schoolYearStart).toISOString(),
      endAt: endAt.toISOString(),
    }
  }

  const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30
  const startDate = new Date(referenceDate)
  startDate.setDate(startDate.getDate() - (days - 1))

  return {
    preset,
    startAt: startOfLocalDay(startDate).toISOString(),
    endAt: endAt.toISOString(),
  }
}

export function getSchoolYearStart(referenceDate: Date): Date {
  const year =
    referenceDate.getMonth() >= SCHOOL_YEAR_START_MONTH
      ? referenceDate.getFullYear()
      : referenceDate.getFullYear() - 1

  return new Date(year, SCHOOL_YEAR_START_MONTH, 1)
}

function startOfLocalDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfLocalDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

export function isWithinDateRange(isoDate: string, range: DashboardDateRange): boolean {
  const value = new Date(isoDate).getTime()
  const start = new Date(range.startAt).getTime()
  const end = new Date(range.endAt).getTime()

  if (Number.isNaN(value) || Number.isNaN(start) || Number.isNaN(end)) {
    return false
  }

  return value >= start && value <= end
}

export function aggregateStatusCounts(requests: readonly AnalyticsRequestRow[]): StatusCountMap {
  const counts = createEmptyStatusCounts()

  for (const request of requests) {
    counts[request.status] += 1
  }

  return counts
}

export function aggregateTypeCounts(requests: readonly AnalyticsRequestRow[]): RequestTypeCountMap {
  const counts = createEmptyTypeCounts()

  for (const request of requests) {
    counts[request.request_type] += 1
  }

  return counts
}

export function shouldUseWeeklyBuckets(range: DashboardDateRange): boolean {
  return range.preset === '90d' || range.preset === 'school_year'
}

export function buildSubmissionTrend(
  requests: readonly AnalyticsRequestRow[],
  range: DashboardDateRange,
): TimeSeriesPoint[] {
  const buckets = createTimeBuckets(range, shouldUseWeeklyBuckets(range))
  const counts = new Map(buckets.map((bucket) => [bucket.bucketStart, 0]))

  for (const request of requests) {
    if (!isWithinDateRange(request.created_at, range)) {
      continue
    }

    const bucketStart = getBucketStartForDate(request.created_at, range)
    if (counts.has(bucketStart)) {
      counts.set(bucketStart, (counts.get(bucketStart) ?? 0) + 1)
    }
  }

  return buckets.map((bucket) => ({
    ...bucket,
    count: counts.get(bucket.bucketStart) ?? 0,
  }))
}

export function buildProcessingTimeTrend(
  requestsById: ReadonlyMap<string, AnalyticsRequestRow>,
  resolutions: readonly AnalyticsResolutionRow[],
  range: DashboardDateRange,
): ProcessingTimePoint[] {
  const buckets = createTimeBuckets(range, shouldUseWeeklyBuckets(range))
  const bucketDurations = new Map(buckets.map((bucket) => [bucket.bucketStart, [] as number[]]))

  for (const resolution of resolutions) {
    if (!isWithinDateRange(resolution.resolved_at, range)) {
      continue
    }

    const request = requestsById.get(resolution.request_id)
    if (!request) {
      continue
    }

    const durationHours = calculateProcessingTimeHours(request.created_at, resolution.resolved_at)
    if (durationHours === null) {
      continue
    }

    const bucketStart = getBucketStartForDate(resolution.resolved_at, range)
    const durations = bucketDurations.get(bucketStart)
    if (durations) {
      durations.push(durationHours)
    }
  }

  return buckets.map((bucket) => {
    const durations = bucketDurations.get(bucket.bucketStart) ?? []
    return {
      bucketStart: bucket.bucketStart,
      label: bucket.label,
      averageHours:
        durations.length > 0
          ? roundToOneDecimal(durations.reduce((sum, value) => sum + value, 0) / durations.length)
          : null,
      resolvedCount: durations.length,
    }
  })
}

export function calculateAverageProcessingTimeHours(
  requestsById: ReadonlyMap<string, AnalyticsRequestRow>,
  resolutions: readonly AnalyticsResolutionRow[],
  range: DashboardDateRange,
): number | null {
  const durations: number[] = []

  for (const resolution of resolutions) {
    if (!isWithinDateRange(resolution.resolved_at, range)) {
      continue
    }

    const request = requestsById.get(resolution.request_id)
    if (!request) {
      continue
    }

    const durationHours = calculateProcessingTimeHours(request.created_at, resolution.resolved_at)
    if (durationHours !== null) {
      durations.push(durationHours)
    }
  }

  if (durations.length === 0) {
    return null
  }

  return roundToOneDecimal(durations.reduce((sum, value) => sum + value, 0) / durations.length)
}

/**
 * Processing time is measured from request creation until the first
 * completed/rejected status history entry.
 */
export function calculateProcessingTimeHours(
  createdAt: string,
  resolvedAt: string,
): number | null {
  const createdMs = new Date(createdAt).getTime()
  const resolvedMs = new Date(resolvedAt).getTime()

  if (Number.isNaN(createdMs) || Number.isNaN(resolvedMs) || resolvedMs < createdMs) {
    return null
  }

  return roundToOneDecimal((resolvedMs - createdMs) / (1000 * 60 * 60))
}

/**
 * Completion rate = completed / (completed + rejected)
 * for requests resolved within the selected period.
 */
export function calculateCompletionRate(
  resolutions: readonly AnalyticsResolutionRow[],
  range: DashboardDateRange,
): number | null {
  let completed = 0
  let rejected = 0

  for (const resolution of resolutions) {
    if (!isWithinDateRange(resolution.resolved_at, range)) {
      continue
    }

    if (resolution.new_status === 'completed') {
      completed += 1
    } else {
      rejected += 1
    }
  }

  const resolved = completed + rejected
  if (resolved === 0) {
    return null
  }

  return roundToOneDecimal((completed / resolved) * 100)
}

export function buildCompletionRateTrend(
  resolutions: readonly AnalyticsResolutionRow[],
  range: DashboardDateRange,
): CompletionRatePoint[] {
  const buckets = createTimeBuckets(range, shouldUseWeeklyBuckets(range))
  const bucketStats = new Map(
    buckets.map((bucket) => [
      bucket.bucketStart,
      { completed: 0, rejected: 0 },
    ]),
  )

  for (const resolution of resolutions) {
    if (!isWithinDateRange(resolution.resolved_at, range)) {
      continue
    }

    const bucketStart = getBucketStartForDate(resolution.resolved_at, range)
    const stats = bucketStats.get(bucketStart)
    if (!stats) {
      continue
    }

    if (resolution.new_status === 'completed') {
      stats.completed += 1
    } else {
      stats.rejected += 1
    }
  }

  return buckets.map((bucket) => {
    const stats = bucketStats.get(bucket.bucketStart) ?? { completed: 0, rejected: 0 }
    const resolvedCount = stats.completed + stats.rejected

    return {
      bucketStart: bucket.bucketStart,
      label: bucket.label,
      resolvedCount,
      completionRate:
        resolvedCount > 0 ? roundToOneDecimal((stats.completed / resolvedCount) * 100) : null,
    }
  })
}

export function buildWorkloadAging(
  activeRequests: readonly AnalyticsRequestRow[],
  referenceDate: Date = new Date(),
): WorkloadAgingBucket[] {
  const counts: Record<WorkloadAgingBucketId, number> = {
    under_24h: 0,
    '1_3_days': 0,
    '4_7_days': 0,
    over_7_days: 0,
  }

  const now = referenceDate.getTime()

  for (const request of activeRequests) {
    const createdMs = new Date(request.created_at).getTime()
    if (Number.isNaN(createdMs)) {
      continue
    }

    const ageHours = (now - createdMs) / (1000 * 60 * 60)

    if (ageHours < 24) {
      counts.under_24h += 1
    } else if (ageHours < 72) {
      counts['1_3_days'] += 1
    } else if (ageHours < 168) {
      counts['4_7_days'] += 1
    } else {
      counts.over_7_days += 1
    }
  }

  return [
    { id: 'under_24h', label: 'פחות מ-24 שעות', count: counts.under_24h },
    { id: '1_3_days', label: '1–3 ימים', count: counts['1_3_days'] },
    { id: '4_7_days', label: '4–7 ימים', count: counts['4_7_days'] },
    { id: 'over_7_days', label: 'יותר מ-7 ימים', count: counts.over_7_days },
  ]
}

export function findLongestAwaitingHours(
  requests: readonly AnalyticsRequestRow[],
  referenceDate: Date = new Date(),
): number | null {
  const active = requests.filter(
    (request) => request.status === 'new' || request.status === 'in_progress',
  )

  if (active.length === 0) {
    return null
  }

  const now = referenceDate.getTime()
  let longest = 0

  for (const request of active) {
    const createdMs = new Date(request.created_at).getTime()
    if (Number.isNaN(createdMs)) {
      continue
    }

    const hours = (now - createdMs) / (1000 * 60 * 60)
    longest = Math.max(longest, hours)
  }

  return roundToOneDecimal(longest)
}

function createTimeBuckets(
  range: DashboardDateRange,
  weekly: boolean,
): Array<{ bucketStart: string; label: string }> {
  const buckets: Array<{ bucketStart: string; label: string }> = []
  const start = startOfLocalDay(new Date(range.startAt))
  const end = startOfLocalDay(new Date(range.endAt))
  const cursor = new Date(start)

  if (weekly) {
    alignToWeekStart(cursor)
    while (cursor.getTime() <= end.getTime()) {
      const bucketStart = toLocalDateKey(cursor)
      buckets.push({
        bucketStart,
        label: formatBucketLabel(cursor, true),
      })
      cursor.setDate(cursor.getDate() + 7)
    }
    return buckets
  }

  while (cursor.getTime() <= end.getTime()) {
    const bucketStart = toLocalDateKey(cursor)
    buckets.push({
      bucketStart,
      label: formatBucketLabel(cursor, false),
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return buckets
}

function getBucketStartForDate(isoDate: string, range: DashboardDateRange): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    return toLocalDateKey(new Date(range.startAt))
  }

  if (shouldUseWeeklyBuckets(range)) {
    const weekStart = new Date(date)
    alignToWeekStart(weekStart)
    return toLocalDateKey(weekStart)
  }

  return toLocalDateKey(date)
}

function alignToWeekStart(date: Date): void {
  const day = date.getDay()
  const diff = day === 0 ? 0 : day
  date.setDate(date.getDate() - diff)
  date.setHours(0, 0, 0, 0)
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatBucketLabel(date: Date, weekly: boolean): string {
  if (weekly) {
    return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
  }

  return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

export function isSecretaryVisibleGeneralRequest(request: AnalyticsRequestRow): boolean {
  if (request.request_type !== 'general_request') {
    return true
  }

  return request.recipient_role === 'secretary'
}

export function filterSecretaryAnalyticsRequests(
  requests: readonly AnalyticsRequestRow[],
): AnalyticsRequestRow[] {
  return requests.filter(isSecretaryVisibleGeneralRequest)
}
