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
      <div className="teacher-dashboard__empty-state">
        <p className="teacher-dashboard__empty-message">אין לך בקשות פעילות כרגע.</p>
        <p className="teacher-dashboard__helper-text">כאן יופיעו הבקשות שתפתחי בהמשך.</p>
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
              <td>{translateRequestStatus(request.status)}</td>
              <td>{formatRequestDate(request.created_at)}</td>
              <td>{request.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
