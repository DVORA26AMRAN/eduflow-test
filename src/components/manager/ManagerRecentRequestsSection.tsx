import type { ManagerRecentRequest } from '../../types/analytics'
import {
  formatRequestDate,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'

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
      <h2 className="manager-dashboard__section-title">בקשות אחרונות</h2>

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
                  <td>{translateRequestStatus(request.status)}</td>
                  <td>{formatRequestDate(request.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
