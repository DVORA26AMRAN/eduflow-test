import { useCallback, useEffect, useState } from 'react'
import type {
  DashboardDateRangePreset,
  DashboardRequestNavigationIntent,
  TeacherDashboardAnalytics,
} from '../../types/dashboardAnalytics'
import type { RequestStatus, RequestType, TeacherRequest } from '../../types/request'
import type { TeacherRequestReminderState } from '../../types/requestReminder'
import { loadTeacherDashboardAnalytics } from '../../services/dashboardAnalytics'
import { canSendRequestReminder, sendRequestReminder } from '../../services/requestReminders'
import { resolveDashboardDateRange } from '../../utils/dashboardAnalytics'
import { NavChartIcon } from '../dashboard/dashboardNav'
import { DashboardAnalyticsState } from '../dashboard/analytics/DashboardAnalyticsState'
import { DashboardAttentionList } from '../dashboard/analytics/DashboardAttentionList'
import { DashboardDateRangeSelector } from '../dashboard/analytics/DashboardDateRangeSelector'
import { DashboardMetricCard } from '../dashboard/analytics/DashboardMetricCard'
import { RequestStatusChart } from '../dashboard/analytics/RequestStatusChart'
import { RequestTrendChart, RequestTypeChart } from '../dashboard/analytics/RequestTrendChart'
import { RequestReminderBellButton } from '../requests/RequestReminderBellButton'
import '../dashboard/analytics/dashboardAnalytics.css'

type TeacherAnalyticsSectionProps = {
  refreshToken: number
  reminderStatesByRequestId: ReadonlyMap<string, TeacherRequestReminderState>
  onNavigateToRequests: (intent: DashboardRequestNavigationIntent) => void
  onReminderSent?: () => void
}

export function TeacherAnalyticsSection({
  refreshToken,
  reminderStatesByRequestId,
  onNavigateToRequests,
  onReminderSent,
}: TeacherAnalyticsSectionProps) {
  const [remindingRequestId, setRemindingRequestId] = useState<string | null>(null)
  const [dateRangePreset, setDateRangePreset] = useState<DashboardDateRangePreset>('30d')
  const [analytics, setAnalytics] = useState<TeacherDashboardAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const loadAnalytics = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')

    const dateRange = resolveDashboardDateRange(dateRangePreset)
    const result = await loadTeacherDashboardAnalytics(dateRange)

    if (!result.ok) {
      setAnalytics(null)
      setErrorMessage(result.errorMessage)
    } else {
      setAnalytics(result.analytics)
    }

    setIsLoading(false)
  }, [dateRangePreset])

  useEffect(() => {
    queueMicrotask(() => {
      void loadAnalytics()
    })
  }, [loadAnalytics, refreshToken])

  function handleStatusNavigate(status: RequestStatus) {
    onNavigateToRequests({ requestStatus: status })
  }

  function handleTypeNavigate(requestType: RequestType) {
    onNavigateToRequests({ requestType })
  }

  async function handleSendReminder(request: TeacherRequest) {
    if (remindingRequestId !== null) {
      return
    }

    setRemindingRequestId(request.id)
    const result = await sendRequestReminder(request.id)
    setRemindingRequestId(null)

    if (result.ok) {
      onReminderSent?.()
    }
  }

  const isEmpty = !isLoading && !errorMessage && analytics?.totalSubmitted === 0

  return (
    <section className="dashboard-analytics teacher-dashboard__analytics" aria-label="סקירה כללית">
      <header className="dashboard-analytics__header">
        <div>
          <h2 className="dashboard-analytics__title">
            <span className="dashboard-card__title-icon" aria-hidden="true">
              <NavChartIcon />
            </span>
            סקירה כללית
          </h2>
          <p className="dashboard-analytics__subtitle">מעקב אחר הבקשות ששלחת</p>
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
              <DashboardMetricCard
                label="סך הבקשות שנשלחו"
                value={analytics.totalSubmitted}
              />
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
                label="הושלמו"
                value={analytics.statusCounts.completed}
                onClick={() => handleStatusNavigate('completed')}
              />
              <DashboardMetricCard
                label="נדחו"
                value={analytics.statusCounts.rejected}
                onClick={() => handleStatusNavigate('rejected')}
              />
              {analytics.longestAwaitingHours !== null ? (
                <DashboardMetricCard
                  label="הבקשה הוותיקה ביותר ממתינה (שעות)"
                  value={analytics.longestAwaitingHours}
                />
              ) : null}
            </div>

            <div className="dashboard-analytics__charts">
              <RequestStatusChart
                title="התפלגות לפי סטטוס"
                counts={analytics.statusCounts}
                onStatusSelect={handleStatusNavigate}
              />
              <RequestTrendChart title="בקשות לאורך זמן" points={analytics.trend} />
              <RequestTypeChart
                title="בקשות לפי סוג"
                counts={analytics.typeCounts}
                onTypeSelect={handleTypeNavigate}
              />
            </div>

            <DashboardAttentionList
              title="בקשות שדורשות מעקב"
              items={analytics.followUpRequests}
              emptyMessage="אין בקשות פעילות שדורשות מעקב כרגע."
              actions={(item) => {
                const reminderState = reminderStatesByRequestId.get(item.id)
                const request: TeacherRequest = {
                  id: item.id,
                  request_type: item.requestType,
                  description: item.description,
                  status: item.status,
                  created_at: item.createdAt,
                }

                return (
                  <RequestReminderBellButton
                    requestStatus={request.status}
                    isVisible={canSendRequestReminder(request.status)}
                    isDisabled={
                      remindingRequestId !== null ||
                      Boolean(reminderState?.next_reminder_available_at)
                    }
                    isSending={remindingRequestId === request.id}
                    disabledReason={
                      reminderState?.next_reminder_available_at
                        ? 'ניתן לשלוח תזכורת נוספת רק לאחר תקופת ההמתנה'
                        : undefined
                    }
                    onSendReminder={() => void handleSendReminder(request)}
                  />
                )
              }}
            />
          </>
        ) : null}
      </DashboardAnalyticsState>
    </section>
  )
}
