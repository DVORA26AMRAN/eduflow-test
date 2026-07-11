import type { ManagerRecentActivityEntry } from '../../types/analytics'
import { formatRequestDateTime, translateRequestStatus } from '../../utils/requests'
import { NavActivityIcon } from '../dashboard/dashboardNav'
import { DashboardCollapsibleSection } from '../dashboard/DashboardCollapsibleSection'

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
      <DashboardCollapsibleSection
        title="פעילות אחרונה"
        icon={<NavActivityIcon />}
        className="dashboard-collapsible-section--flush-header"
      >
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
                  <span className={`ds-table__status ds-table__status--${entry.previous_status}`}>
                    {translateRequestStatus(entry.previous_status)}
                  </span>{' '}
                  ←{' '}
                  <span className={`ds-table__status ds-table__status--${entry.new_status}`}>
                    {translateRequestStatus(entry.new_status)}
                  </span>
                </p>
                <p className="manager-dashboard__activity-meta">
                  {formatRequestDateTime(entry.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DashboardCollapsibleSection>
    </section>
  )
}
