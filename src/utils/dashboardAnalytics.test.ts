import { describe, expect, it } from 'vitest'
import {
  aggregateStatusCounts,
  aggregateTypeCounts,
  buildCompletionRateTrend,
  buildSubmissionTrend,
  buildWorkloadAging,
  calculateCompletionRate,
  calculateProcessingTimeHours,
  filterSecretaryAnalyticsRequests,
  isSecretaryVisibleGeneralRequest,
  resolveDashboardDateRange,
} from './dashboardAnalytics'
import type { AnalyticsRequestRow, AnalyticsResolutionRow } from './dashboardAnalytics'

const baseRequest = (
  overrides: Partial<AnalyticsRequestRow> = {},
): AnalyticsRequestRow => ({
  id: 'req-1',
  request_type: 'absence',
  status: 'new',
  created_at: '2026-07-01T10:00:00.000Z',
  ...overrides,
})

describe('resolveDashboardDateRange', () => {
  it('defaults to 30 days', () => {
    const range = resolveDashboardDateRange('30d', new Date('2026-07-12T12:00:00.000Z'))
    expect(range.preset).toBe('30d')
    expect(new Date(range.startAt).getTime()).toBeLessThanOrEqual(
      new Date('2026-06-13T00:00:00.000Z').getTime() + 24 * 60 * 60 * 1000,
    )
    expect(range.endAt.slice(0, 10)).toBe('2026-07-12')
  })

  it('starts the school year on September 1', () => {
    const range = resolveDashboardDateRange('school_year', new Date('2026-03-01T12:00:00.000Z'))
    const start = new Date(range.startAt)
    expect(start.getMonth()).toBe(8)
    expect(start.getDate()).toBe(1)
  })
})

describe('secretary general request visibility', () => {
  it('excludes manager-addressed general requests from secretary analytics', () => {
    const requests = [
      baseRequest({ id: 'a', request_type: 'general_request', recipient_role: 'secretary' }),
      baseRequest({
        id: 'b',
        request_type: 'general_request',
        recipient_role: 'institution_manager',
      }),
      baseRequest({ id: 'c', request_type: 'absence' }),
    ]

    expect(filterSecretaryAnalyticsRequests(requests)).toHaveLength(2)
    expect(isSecretaryVisibleGeneralRequest(requests[1])).toBe(false)
  })
})

describe('status and type aggregation', () => {
  it('aggregates status counts correctly', () => {
    const counts = aggregateStatusCounts([
      baseRequest({ status: 'new' }),
      baseRequest({ id: '2', status: 'new' }),
      baseRequest({ id: '3', status: 'completed' }),
    ])

    expect(counts.new).toBe(2)
    expect(counts.completed).toBe(1)
    expect(counts.in_progress).toBe(0)
  })

  it('aggregates request types including historical substitute_teacher', () => {
    const counts = aggregateTypeCounts([
      baseRequest({ request_type: 'substitute_teacher' }),
      baseRequest({ id: '2', request_type: 'general_request' }),
    ])

    expect(counts.substitute_teacher).toBe(1)
    expect(counts.general_request).toBe(1)
  })
})

describe('processing and completion calculations', () => {
  it('calculates processing time from creation to resolution', () => {
    const hours = calculateProcessingTimeHours(
      '2026-07-01T10:00:00.000Z',
      '2026-07-01T14:00:00.000Z',
    )
    expect(hours).toBe(4)
  })

  it('calculates completion rate as completed / resolved', () => {
    const range = resolveDashboardDateRange('30d', new Date('2026-07-12T12:00:00.000Z'))
    const resolutions: AnalyticsResolutionRow[] = [
      {
        request_id: '1',
        resolved_at: '2026-07-05T10:00:00.000Z',
        new_status: 'completed',
      },
      {
        request_id: '2',
        resolved_at: '2026-07-06T10:00:00.000Z',
        new_status: 'rejected',
      },
      {
        request_id: '3',
        resolved_at: '2026-07-07T10:00:00.000Z',
        new_status: 'completed',
      },
    ]

    expect(calculateCompletionRate(resolutions, range)).toBe(66.7)
  })

  it('builds completion trend buckets with the same formula', () => {
    const range = resolveDashboardDateRange('7d', new Date('2026-07-07T12:00:00.000Z'))
    const trend = buildCompletionRateTrend(
      [
        {
          request_id: '1',
          resolved_at: '2026-07-07T10:00:00.000Z',
          new_status: 'completed',
        },
        {
          request_id: '2',
          resolved_at: '2026-07-07T11:00:00.000Z',
          new_status: 'rejected',
        },
      ],
      range,
    )

    const lastPoint = trend.at(-1)
    expect(lastPoint?.completionRate).toBe(50)
    expect(lastPoint?.resolvedCount).toBe(2)
  })
})

describe('time series and workload aging', () => {
  it('builds daily submission buckets for short ranges', () => {
    const range = resolveDashboardDateRange('7d', new Date('2026-07-07T12:00:00.000Z'))
    const trend = buildSubmissionTrend(
      [
        baseRequest({ created_at: '2026-07-05T08:00:00.000Z' }),
        baseRequest({ id: '2', created_at: '2026-07-05T12:00:00.000Z' }),
      ],
      range,
    )

    const julyFifth = trend.find((point) => point.bucketStart === '2026-07-05')
    expect(julyFifth?.count).toBe(2)
  })

  it('groups active workload into aging buckets by creation time', () => {
    const referenceDate = new Date('2026-07-12T10:00:00.000Z')
    const buckets = buildWorkloadAging(
      [
        baseRequest({ created_at: '2026-07-11T12:00:00.000Z', status: 'new' }),
        baseRequest({ id: '2', created_at: '2026-06-01T10:00:00.000Z', status: 'in_progress' }),
      ],
      referenceDate,
    )

    expect(buckets.find((bucket) => bucket.id === 'under_24h')?.count).toBe(1)
    expect(buckets.find((bucket) => bucket.id === 'over_7_days')?.count).toBe(1)
  })
})
