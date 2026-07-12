import type { ManagerAnalytics } from '../../types/analytics'
import type { RequestType } from '../../types/request'
import { NavChartIcon } from '../dashboard/dashboardNav'

type ManagerRequestTypeDistributionProps = {
  analytics: ManagerAnalytics | null
  isLoading: boolean
  errorMessage: string
}

type RequestTypeRow = {
  type: RequestType
  label: string
  count: number
}

const REQUEST_TYPE_ROWS: { type: RequestType; label: string }[] = [
  { type: 'absence', label: 'היעדרויות' },
  { type: 'budget_or_equipment', label: 'תקציב / ציוד' },
  { type: 'substitute_teacher', label: 'מילויי מקום' },
  { type: 'general_request', label: 'בקשה אחרת' },
]

export function ManagerRequestTypeDistribution({
  analytics,
  isLoading,
  errorMessage,
}: ManagerRequestTypeDistributionProps) {
  if (isLoading || errorMessage || !analytics) {
    return null
  }

  const rows: RequestTypeRow[] = REQUEST_TYPE_ROWS.map((row) => ({
    ...row,
    count: analytics.requestTypeCounts[row.type],
  }))

  const maxCount = Math.max(...rows.map((row) => row.count), 1)
  const totalTypeCount = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <section
      className="ds-card manager-dashboard__type-distribution"
      aria-label="התפלגות בקשות לפי סוג"
    >
      <h2 className="manager-dashboard__section-title">
        <span className="dashboard-card__title-icon" aria-hidden="true">
          <NavChartIcon />
        </span>
        התפלגות לפי סוג בקשה
      </h2>

      {totalTypeCount === 0 ? (
        <p className="manager-dashboard__type-distribution-status">אין בקשות להצגה.</p>
      ) : (
        <ul className="manager-dashboard__type-distribution-list">
          {rows.map((row) => (
            <li key={row.type} className="manager-dashboard__type-distribution-item">
              <div className="manager-dashboard__type-distribution-header">
                <span className="manager-dashboard__type-distribution-label">{row.label}</span>
                <span className="manager-dashboard__type-distribution-count">{row.count}</span>
              </div>
              <div
                className="manager-dashboard__type-distribution-track"
                role="presentation"
                aria-hidden="true"
              >
                <div
                  className={`manager-dashboard__type-distribution-bar manager-dashboard__type-distribution-bar--${row.type}`}
                  style={{ width: `${(row.count / maxCount) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
