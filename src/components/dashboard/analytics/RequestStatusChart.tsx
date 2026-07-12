import type { StatusCountMap } from '../../../types/dashboardAnalytics'
import type { RequestStatus } from '../../../types/request'
import { translateRequestStatus } from '../../../utils/requests'

type RequestStatusChartProps = {
  title: string
  counts: StatusCountMap
  onStatusSelect?: (status: RequestStatus) => void
  statuses?: RequestStatus[]
}

const DEFAULT_STATUSES: RequestStatus[] = ['new', 'in_progress', 'completed', 'rejected']

export function RequestStatusChart({
  title,
  counts,
  onStatusSelect,
  statuses = DEFAULT_STATUSES,
}: RequestStatusChartProps) {
  const rows = statuses.map((status) => ({
    status,
    label: translateRequestStatus(status),
    count: counts[status],
  }))
  const maxCount = Math.max(...rows.map((row) => row.count), 1)
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <section className="ds-card dashboard-analytics__chart-card" aria-label={title}>
      <h3 className="dashboard-analytics__chart-title">{title}</h3>
      <p className="dashboard-analytics__chart-summary">סה&quot;כ {total} בקשות</p>

      {total === 0 ? (
        <p className="dashboard-analytics__chart-summary">אין נתונים להצגה בטווח שנבחר.</p>
      ) : (
        <ul className="dashboard-analytics__bar-list">
          {rows.map((row) => {
            const bar = (
              <>
                <div className="dashboard-analytics__bar-header">
                  <span className="dashboard-analytics__bar-label">{row.label}</span>
                  <span className="dashboard-analytics__bar-value">{row.count}</span>
                </div>
                <div className="dashboard-analytics__bar-track" aria-hidden="true">
                  <div
                    className={`dashboard-analytics__bar-fill dashboard-analytics__bar-fill--${row.status}`}
                    style={{ width: `${(row.count / maxCount) * 100}%` }}
                  />
                </div>
              </>
            )

            return (
              <li key={row.status} className="dashboard-analytics__bar-item">
                {onStatusSelect ? (
                  <button
                    type="button"
                    className="dashboard-analytics__bar-button"
                    aria-label={`${row.label}: ${row.count}`}
                    onClick={() => onStatusSelect(row.status)}
                  >
                    {bar}
                  </button>
                ) : (
                  bar
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
