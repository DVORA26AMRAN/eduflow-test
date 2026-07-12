import { useCallback, useEffect, useState } from 'react'
import type {
  DashboardDateRangePreset,
  DashboardRequestNavigationIntent,
  ManagerDashboardAnalytics,
} from '../../types/dashboardAnalytics'
import type { RequestStatus, RequestType } from '../../types/request'
import type { RequestReminderSummary } from '../../types/requestReminder'
import { loadManagerDashboardAnalytics } from '../../services/dashboardAnalytics'
import { resolveDashboardDateRange } from '../../utils/dashboardAnalytics'
import { translateRequestType } from '../../utils/requests'
import { NavChartIcon } from '../dashboard/dashboardNav'
import { DashboardAnalyticsState } from '../dashboard/analytics/DashboardAnalyticsState'
import { DashboardAttentionList } from '../dashboard/analytics/DashboardAttentionList'
import { DashboardDateRangeSelector } from '../dashboard/analytics/DashboardDateRangeSelector'
import { DashboardMetricCard } from '../dashboard/analytics/DashboardMetricCard'
import { RequestStatusChart } from '../dashboard/analytics/RequestStatusChart'
import {
  CompletionTrendChart,
  ProcessingTrendChart,
  RequestTrendChart,
  RequestTypeChart,
  WorkloadAgingChart,
} from '../dashboard/analytics/RequestTrendChart'
import '../dashboard/analytics/dashboardAnalytics.css'

type ManagerAnalyticsSectionProps = {
  refreshToken: number
  reminderSummariesByRequestId: ReadonlyMap<string, RequestReminderSummary>
  onNavigateToRecentActivity: (intent: DashboardRequestNavigationIntent) => void
}

export function ManagerAnalyticsSection({
  refreshToken,
  reminderSummariesByRequestId,
  onNavigateToRecentActivity,
}: ManagerAnalyticsSectionProps) {
  const [dateRangePreset, setDateRangePreset] = useState<DashboardDateRangePreset>('30d')
  const [analytics, setAnalytics] = useState<ManagerDashboardAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const loadAnalytics = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')

    const dateRange = resolveDashboardDateRange(dateRangePreset)
    const result = await loadManagerDashboardAnalytics(dateRange, reminderSummariesByRequestId)

    if (!result.ok) {
      setAnalytics(null)
      setErrorMessage(result.errorMessage)
    } else {
      setAnalytics(result.analytics)
    }

    setIsLoading(false)
  }, [dateRangePreset, reminderSummariesByRequestId])

  useEffect(() => {
    queueMicrotask(() => {
      void loadAnalytics()
    })
  }, [loadAnalytics, refreshToken])

  function handleStatusNavigate(status: RequestStatus) {
    onNavigateToRecentActivity({ requestStatus: status })
  }

  function handleTypeNavigate(requestType: RequestType) {
    onNavigateToRecentActivity({ requestType })
  }

  const isEmpty = !isLoading && !errorMessage && analytics?.totalInstitutionRequests === 0

  return (
    <section className="dashboard-analytics manager-dashboard__analytics" aria-label="סקירה כללית">
      <header className="dashboard-analytics__header">
        <div>
          <h2 className="dashboard-analytics__title">
            <span className="dashboard-card__title-icon" aria-hidden="true">
              <NavChartIcon />
            </span>
            סקירה כללית
          </h2>
          <p className="dashboard-analytics__subtitle">תמונת מצב מוסדית — ללא השפעת ארכיון אישי</p>
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
        emptyMessage="אין בקשות מוסדיות להצגה."
        onRetry={() => void loadAnalytics()}
      >
        {analytics ? (
          <>
            <div className="dashboard-analytics__metrics">
              <DashboardMetricCard
                label="סך בקשות המוסד"
                value={analytics.totalInstitutionRequests}
              />
              <DashboardMetricCard label="בקשות פעילות" value={analytics.activeRequests} />
              <DashboardMetricCard
                label="חדש"
                value={analytics.statusCounts.new}
                onClick={() => handleStatusNavigate('new')}
              />
              <DashboardMetricCard
                label="בטיפול"
                value={analytics.statusCounts.in_progress}
                onClick={() => handleStatusNavigate('in_progress')}
              />
              <DashboardMetricCard
                label="שיעור השלמה"
                value={
                  analytics.completionRate !== null ? `${analytics.completionRate}%` : '—'
                }
              />
              <DashboardMetricCard
                label="בקשות עם תזכורות"
                value={analytics.requestsWithReminders}
              />
            </div>

            <div className="dashboard-analytics__charts">
              <RequestTrendChart title="מגמת בקשות מוסדיות" points={analytics.trend} />
              <RequestStatusChart
                title="התפלגות סטטוסים"
                counts={analytics.statusCounts}
                onStatusSelect={handleStatusNavigate}
              />
              <RequestTypeChart
                title="בקשות לפי סוג"
                counts={analytics.typeCounts}
                onTypeSelect={handleTypeNavigate}
              />
              <CompletionTrendChart
                title="מגמת שיעור השלמה"
                points={analytics.completionTrend}
                summary={
                  analytics.completionRate !== null
                    ? `שיעור השלמה בתקופה: ${analytics.completionRate}%`
                    : null
                }
              />
              <ProcessingTrendChart
                title="זמן טיפול ממוצע"
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
                title="תשומת ניהול"
                items={analytics.attentionRequests}
                emptyMessage="אין בקשות פעילות שדורשות תשומת ניהול."
              />
              <WorkloadAgingChart
                title="בקשות כלליות לפי יעד"
                buckets={[
                  {
                    label: 'למזכירה',
                    count: analytics.generalRequestRouting.secretary,
                  },
                  {
                    label: 'למנהלת',
                    count: analytics.generalRequestRouting.institution_manager,
                  },
                ]}
              />
            </div>

            {analytics.typeBacklog.length > 0 ? (
              <section className="ds-card dashboard-analytics__chart-card" aria-label="צבר פעיל לפי סוג">
                <h3 className="dashboard-analytics__chart-title">צבר פעיל לפי סוג בקשה</h3>
                <ul className="dashboard-analytics__bar-list">
                  {analytics.typeBacklog.map((entry) => (
                    <li key={entry.requestType} className="dashboard-analytics__bar-item">
                      <div className="dashboard-analytics__bar-header">
                        <span className="dashboard-analytics__bar-label">
                          {translateRequestType(entry.requestType)}
                        </span>
                        <span className="dashboard-analytics__bar-value">{entry.activeCount}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </DashboardAnalyticsState>
    </section>
  )
}
