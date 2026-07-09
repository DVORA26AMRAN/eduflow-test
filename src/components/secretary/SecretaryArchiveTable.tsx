import type { SecretaryArchivedRequest } from '../../types/request'
import {
  formatRequestDate,
  formatRequestDateTime,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'

type SecretaryArchiveTableProps = {
  requests: SecretaryArchivedRequest[]
  emptyMessage: string
}

export function SecretaryArchiveTable({ requests, emptyMessage }: SecretaryArchiveTableProps) {
  if (requests.length === 0) {
    return (
      <div className="ds-state secretary-dashboard__empty-state">
        <span className="ds-state__icon" aria-hidden="true">
          🗄️
        </span>
        <p className="ds-state__title">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="ds-table-wrapper secretary-dashboard__table-wrapper">
      <table className="ds-table">
        <thead>
          <tr>
            <th>שם מורה</th>
            <th>סוג בקשה</th>
            <th>סטטוס</th>
            <th>תאריך יצירה</th>
            <th>תאריך ארכוב</th>
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
              <td>{formatRequestDateTime(request.archived_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
