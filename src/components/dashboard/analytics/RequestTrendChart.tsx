import type { RequestTypeCountMap, TimeSeriesPoint } from '../../../types/dashboardAnalytics'
import type { RequestType } from '../../../types/request'
import { translateRequestType } from '../../../utils/requests'

type RequestTrendChartProps = {
  title: string
  points: TimeSeriesPoint[]
}

export function RequestTrendChart({ title, points }: RequestTrendChartProps) {
  const maxCount = Math.max(...points.map((point) => point.count), 1)
  const total = points.reduce((sum, point) => sum + point.count, 0)

  return (
    <section className="ds-card dashboard-analytics__chart-card" aria-label={title}>
      <h3 className="dashboard-analytics__chart-title">{title}</h3>
      <p className="dashboard-analytics__chart-summary">סה&quot;כ {total} בקשות בתקופה</p>

      {total === 0 ? (
        <p className="dashboard-analytics__chart-summary">אין נתונים להצגה בטווח שנבחר.</p>
      ) : (
        <ul className="dashboard-analytics__bar-list">
          {points.map((point) => (
            <li key={point.bucketStart} className="dashboard-analytics__bar-item">
              <div className="dashboard-analytics__bar-header">
                <span className="dashboard-analytics__bar-label">{point.label}</span>
                <span className="dashboard-analytics__bar-value">{point.count}</span>
              </div>
              <div className="dashboard-analytics__bar-track" aria-hidden="true">
                <div
                  className="dashboard-analytics__bar-fill"
                  style={{ width: `${(point.count / maxCount) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const REQUEST_TYPE_ORDER: RequestType[] = [
  'absence',
  'budget_or_equipment',
  'substitute_teacher',
  'general_request',
]

type RequestTypeChartProps = {
  title: string
  counts: RequestTypeCountMap
  onTypeSelect?: (requestType: RequestType) => void
}

export function RequestTypeChart({ title, counts, onTypeSelect }: RequestTypeChartProps) {
  const rows = REQUEST_TYPE_ORDER.map((requestType) => ({
    requestType,
    label: translateRequestType(requestType),
    count: counts[requestType],
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
                    className={`dashboard-analytics__bar-fill dashboard-analytics__bar-fill--${row.requestType}`}
                    style={{ width: `${(row.count / maxCount) * 100}%` }}
                  />
                </div>
              </>
            )

            return (
              <li key={row.requestType} className="dashboard-analytics__bar-item">
                {onTypeSelect ? (
                  <button
                    type="button"
                    className="dashboard-analytics__bar-button"
                    aria-label={`${row.label}: ${row.count}`}
                    onClick={() => onTypeSelect(row.requestType)}
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

type ProcessingTrendChartProps = {
  title: string
  points: Array<{ label: string; averageHours: number | null; resolvedCount: number }>
  summary?: string | null
}

export function ProcessingTrendChart({ title, points, summary }: ProcessingTrendChartProps) {
  const validPoints = points.filter((point) => point.averageHours !== null)
  const maxHours = Math.max(...validPoints.map((point) => point.averageHours ?? 0), 1)

  return (
    <section className="ds-card dashboard-analytics__chart-card" aria-label={title}>
      <h3 className="dashboard-analytics__chart-title">{title}</h3>
      {summary ? <p className="dashboard-analytics__chart-summary">{summary}</p> : null}

      {validPoints.length === 0 ? (
        <p className="dashboard-analytics__chart-summary">אין נתונים להצגה בטווח שנבחר.</p>
      ) : (
        <ul className="dashboard-analytics__bar-list">
          {points.map((point) => (
            <li key={point.label} className="dashboard-analytics__bar-item">
              <div className="dashboard-analytics__bar-header">
                <span className="dashboard-analytics__bar-label">{point.label}</span>
                <span className="dashboard-analytics__bar-value">
                  {point.averageHours !== null ? `${point.averageHours} שעות` : '—'}
                </span>
              </div>
              {point.averageHours !== null ? (
                <div className="dashboard-analytics__bar-track" aria-hidden="true">
                  <div
                    className="dashboard-analytics__bar-fill"
                    style={{ width: `${(point.averageHours / maxHours) * 100}%` }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type CompletionTrendChartProps = {
  title: string
  points: Array<{ label: string; completionRate: number | null; resolvedCount: number }>
  summary?: string | null
}

export function CompletionTrendChart({ title, points, summary }: CompletionTrendChartProps) {
  const validPoints = points.filter((point) => point.completionRate !== null)
  const maxRate = Math.max(...validPoints.map((point) => point.completionRate ?? 0), 1)

  return (
    <section className="ds-card dashboard-analytics__chart-card" aria-label={title}>
      <h3 className="dashboard-analytics__chart-title">{title}</h3>
      {summary ? <p className="dashboard-analytics__chart-summary">{summary}</p> : null}

      {validPoints.length === 0 ? (
        <p className="dashboard-analytics__chart-summary">אין נתונים להצגה בטווח שנבחר.</p>
      ) : (
        <ul className="dashboard-analytics__bar-list">
          {points.map((point) => (
            <li key={point.label} className="dashboard-analytics__bar-item">
              <div className="dashboard-analytics__bar-header">
                <span className="dashboard-analytics__bar-label">{point.label}</span>
                <span className="dashboard-analytics__bar-value">
                  {point.completionRate !== null ? `${point.completionRate}%` : '—'}
                </span>
              </div>
              {point.completionRate !== null ? (
                <div className="dashboard-analytics__bar-track" aria-hidden="true">
                  <div
                    className="dashboard-analytics__bar-fill dashboard-analytics__bar-fill--completed"
                    style={{ width: `${(point.completionRate / maxRate) * 100}%` }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type WorkloadAgingChartProps = {
  title: string
  buckets: Array<{ label: string; count: number }>
}

export function WorkloadAgingChart({ title, buckets }: WorkloadAgingChartProps) {
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1)
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)

  return (
    <section className="ds-card dashboard-analytics__chart-card" aria-label={title}>
      <h3 className="dashboard-analytics__chart-title">{title}</h3>
      <p className="dashboard-analytics__chart-summary">סה&quot;כ {total} בקשות פעילות</p>

      {total === 0 ? (
        <p className="dashboard-analytics__chart-summary">אין בקשות פעילות.</p>
      ) : (
        <ul className="dashboard-analytics__bar-list">
          {buckets.map((bucket) => (
            <li key={bucket.label} className="dashboard-analytics__bar-item">
              <div className="dashboard-analytics__bar-header">
                <span className="dashboard-analytics__bar-label">{bucket.label}</span>
                <span className="dashboard-analytics__bar-value">{bucket.count}</span>
              </div>
              <div className="dashboard-analytics__bar-track" aria-hidden="true">
                <div
                  className="dashboard-analytics__bar-fill"
                  style={{ width: `${(bucket.count / maxCount) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
