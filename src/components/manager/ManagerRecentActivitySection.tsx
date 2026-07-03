import type { ManagerRecentActivityEntry } from '../../types/analytics'
import { formatRequestDateTime, translateRequestStatus } from '../../utils/requests'

type ManagerRecentActivitySectionProps = {
  entries: ManagerRecentActivityEntry[]
  isLoading: boolean
  errorMessage: string
}

export function ManagerRecentActivitySection({
  entries,
  isLoading,
  errorMessage,
}: ManagerRecentActivitySectionProps) {
  return (
    <section className="ds-card manager-dashboard__insight-card" aria-label="פעילות אחרונה">
      <h2 className="manager-dashboard__section-title">פעילות אחרונה</h2>

      {isLoading && (
        <p className="manager-dashboard__insight-status">טוען נתונים...</p>
      )}

      {!isLoading && errorMessage && (
        <p className="manager-dashboard__insight-status ds-form-message ds-form-message--error">
          {errorMessage}
        </p>
      )}

      {!isLoading && !errorMessage && entries.length === 0 && (
        <p className="manager-dashboard__insight-status">אין פעילות להצגה.</p>
      )}

      {!isLoading && !errorMessage && entries.length > 0 && (
        <ul className="manager-dashboard__activity-list">
          {entries.map((entry) => (
            <li key={entry.id} className="manager-dashboard__activity-item">
              <p className="manager-dashboard__activity-transition">
                {translateRequestStatus(entry.previous_status)} ←{' '}
                {translateRequestStatus(entry.new_status)}
              </p>
              <p className="manager-dashboard__activity-meta">
                {formatRequestDateTime(entry.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
