import type { TeacherRequest } from '../../types/request'
import {
  formatRequestDate,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'

type TeacherRequestsListProps = {
  requests: TeacherRequest[]
}

export function TeacherRequestsList({ requests }: TeacherRequestsListProps) {
  if (requests.length === 0) {
    return (
      <div className="ds-state teacher-dashboard__empty-state">
        <span className="ds-state__icon" aria-hidden="true">
          📭
        </span>
        <p className="ds-state__title">אין לך בקשות פעילות כרגע.</p>
        <p className="ds-state__message">כאן יופיעו הבקשות שתפתחי בהמשך.</p>
      </div>
    )
  }

  return (
    <div className="ds-table-wrapper">
      <table className="ds-table">
        <thead>
          <tr>
            <th>סוג בקשה</th>
            <th>סטטוס</th>
            <th>תאריך</th>
            <th>תיאור</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td>{translateRequestType(request.request_type)}</td>
              <td>
                <span className={`ds-table__status ds-table__status--${request.status}`}>
                  {translateRequestStatus(request.status)}
                </span>
              </td>
              <td>{formatRequestDate(request.created_at)}</td>
              <td>{request.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
