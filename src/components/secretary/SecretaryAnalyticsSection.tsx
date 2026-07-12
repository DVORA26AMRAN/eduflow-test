import { useCallback, useEffect, useState } from 'react'
import type {
  DashboardDateRangePreset,
  DashboardRequestNavigationIntent,
  SecretaryDashboardAnalytics,
} from '../../types/dashboardAnalytics'
import type { RequestStatus, RequestType } from '../../types/request'
import type { RequestReminderSummary } from '../../types/requestReminder'
import { loadSecretaryDashboardAnalytics } from '../../services/dashboardAnalytics'
import { resolveDashboardDateRange } from '../../utils/dashboardAnalytics'
import { NavChartIcon } from '../dashboard/dashboardNav'
import { DashboardAnalyticsState } from '../dashboard/analytics/DashboardAnalyticsState'
import { DashboardAttentionList } from '../dashboard/analytics/DashboardAttentionList'
import { DashboardDateRangeSelector } from '../dashboard/analytics/DashboardDateRangeSelector'
import { DashboardMetricCard } from '../dashboard/analytics/DashboardMetricCard'
import { RequestStatusChart } from '../dashboard/analytics/RequestStatusChart'
import {
  ProcessingTrendChart,
  RequestTrendChart,
  RequestTypeChart,
  WorkloadAgingChart,
} from '../dashboard/analytics/RequestTrendChart'
import '../dashboard/analytics/dashboardAnalytics.css'

type SecretaryAnalyticsSectionProps = {
  refreshToken: number
  unreadReminderRequestIds: ReadonlySet<string>
  reminderSummariesByRequestId: ReadonlyMap<string, RequestReminderSummary>
  onNavigateToInbox: (intent: DashboardRequestNavigationIntent) => void
}

export function SecretaryAnalyticsSection({
  refreshToken,
  unreadReminderRequestIds,
  reminderSummariesByRequestId,
  onNavigateToInbox,
}: SecretaryAnalyticsSectionProps) {
  const [dateRangePreset, setDateRangePreset] = useState<DashboardDateRangePreset>('30d')
  const [analytics, setAnalytics] = useState<SecretaryDashboardAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const loadAnalytics = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')

    const dateRange = resolveDashboardDateRange(dateRangePreset)
    const result = await loadSecretaryDashboardAnalytics(
      dateRange,
      unreadReminderRequestIds,
      reminderSummariesByRequestId,
    )

    if (!result.ok) {
      setAnalytics(null)
      setErrorMessage(result.errorMessage)
    } else {
      setAnalytics(result.analytics)
    }

    setIsLoading(false)
  }, [dateRangePreset, unreadReminderRequestIds, reminderSummariesByRequestId])

  useEffect(() => {
    queueMicrotask(() => {
      void loadAnalytics()
    })
  }, [loadAnalytics, refreshToken])

  function handleStatusNavigate(status: RequestStatus) {
    onNavigateToInbox({ requestStatus: status })
  }

  function handleTypeNavigate(requestType: RequestType) {
    onNavigateToInbox({ requestType })
  }

  const isEmpty =
    !isLoading &&
    !errorMessage &&
    analytics?.activeRequests === 0 &&
    analytics.completedInPeriod === 0 &&
    analytics.rejectedInPeriod === 0

  return (
    <section className="dashboard-analytics secretary-dashboard__analytics" aria-label="סקירה כללית">
      <header className="dashboard-analytics__header">
        <div>
          <h2 className="dashboard-analytics__title">
            <span className="dashboard-card__title-icon" aria-hidden="true">
              <NavChartIcon />
            </span>
            סקירה כללית
          </h2>
          <p className="dashboard-analytics__subtitle">תמונת עומס תפעולית לבקשות המוסד</p>
        </div>
        <DashboardDateRangeSelector
          value={dateRangePreset}
          onChange={setDateRangePreset}
          disabled={isLoading}
        />
      </header>

      <DashboardAnalyticsState
        isLoading={isLoading}
        errorMessage={errorMessage}
        isEmpty={isEmpty}
        emptyMessage="אין בקשות להצגה בטווח שנבחר."
        onRetry={() => void loadAnalytics()}
      >
        {analytics ? (
          <>
            <div className="dashboard-analytics__metrics">
              <DashboardMetricCard label="בקשות פעילות" value={analytics.activeRequests} />
              <DashboardMetricCard
                label="חדש"
                value={analytics.activeWorkloadCounts.new}
                onClick={() => handleStatusNavigate('new')}
              />
              <DashboardMetricCard
                label="בטיפול"
                value={analytics.activeWorkloadCounts.in_progress}
                onClick={() => handleStatusNavigate('in_progress')}
              />
              <DashboardMetricCard
                label="הושלמו בתקופה"
                value={analytics.completedInPeriod}
                onClick={() => handleStatusNavigate('completed')}
              />
              <DashboardMetricCard
                label="נדחו בתקופה"
                value={analytics.rejectedInPeriod}
                onClick={() => handleStatusNavigate('rejected')}
              />
              <DashboardMetricCard
                label="תזכורות שלא נקראו"
                value={analytics.unreadReminderCount}
              />
            </div>

            <div className="dashboard-analytics__charts">
              <RequestStatusChart
                title="עומס פעיל לפי סטטוס"
                counts={{
                  new: analytics.activeWorkloadCounts.new,
                  in_progress: analytics.activeWorkloadCounts.in_progress,
                  completed: 0,
                  rejected: 0,
                }}
                statuses={['new', 'in_progress']}
                onStatusSelect={handleStatusNavigate}
              />
              <RequestTypeChart
                title="בקשות לפי סוג"
                counts={analytics.typeCounts}
                onTypeSelect={handleTypeNavigate}
              />
              <RequestTrendChart title="בקשות נכנסות לאורך זמן" points={analytics.trend} />
              <ProcessingTrendChart
                title="מגמת זמן טיפול ממוצע"
                points={analytics.processingTimeTrend}
                summary={
                  analytics.averageProcessingHours !== null
                    ? `ממוצע כללי: ${analytics.averageProcessingHours} שעות`
                    : null
                }
              />
            </div>

            <div className="dashboard-analytics__section-grid">
              <DashboardAttentionList
                title="בקשות שדורשות תשומת לב"
                items={analytics.attentionRequests}
                emptyMessage="אין בקשות שדורשות תשומת לב מיידית."
              />
              <WorkloadAgingChart title="התיישנות עומס פעיל" buckets={analytics.workloadAging} />
            </div>
          </>
        ) : null}
      </DashboardAnalyticsState>
    </section>
  )
}
