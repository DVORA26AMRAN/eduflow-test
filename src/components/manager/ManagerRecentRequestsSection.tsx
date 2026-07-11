import type { ManagerRecentRequest } from '../../types/analytics'
import {
  formatRequestDate,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'
import { NavClipboardIcon } from '../dashboard/dashboardNav'
import { DashboardCollapsibleSection } from '../dashboard/DashboardCollapsibleSection'

type ManagerRecentRequestsSectionProps = {
  requests: ManagerRecentRequest[]
  isLoading: boolean
  errorMessage: string
}

export function ManagerRecentRequestsSection({
  requests,
  isLoading,
  errorMessage,
}: ManagerRecentRequestsSectionProps) {
  return (
    <section className="ds-card manager-dashboard__insight-card" aria-label="בקשות אחרונות">
      <DashboardCollapsibleSection
        title="בקשות אחרונות"
        icon={<NavClipboardIcon />}
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

        {!isLoading && !errorMessage && requests.length === 0 && (
          <p className="manager-dashboard__insight-status">אין בקשות להצגה.</p>
        )}

        {!isLoading && !errorMessage && requests.length > 0 && (
          <div className="ds-table-wrapper manager-dashboard__table-wrapper">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>מורה</th>
                  <th>סוג בקשה</th>
                  <th>סטטוס</th>
                  <th>תאריך</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>{request.teacher_full_name}</td>
                    <td>{translateRequestType(request.request_type)}</td>
                    <td>
                      <span className={`ds-table__status ds-table__status--${request.status}`}>
                        {translateRequestStatus(request.status)}
                      </span>
                    </td>
                    <td>{formatRequestDate(request.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCollapsibleSection>
    </section>
  )
}
