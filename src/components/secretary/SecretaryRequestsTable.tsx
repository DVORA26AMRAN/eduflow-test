import type { SecretaryInboxRequest } from '../../types/request'
import {
  formatRequestDate,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'

type SecretaryRequestsTableProps = {
  requests: SecretaryInboxRequest[]
  emptyMessage: string
}

export function SecretaryRequestsTable({
  requests,
  emptyMessage,
}: SecretaryRequestsTableProps) {
  if (requests.length === 0) {
    return (
      <div className="secretary-dashboard__empty-state">
        <p className="secretary-dashboard__empty-message">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="secretary-dashboard__table-wrapper">
      <table className="secretary-dashboard__table">
        <thead>
          <tr>
            <th>שם מורה</th>
            <th>סוג בקשה</th>
            <th>תיאור</th>
            <th>סטטוס</th>
            <th>תאריך</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td>{request.teacher_full_name}</td>
              <td>{translateRequestType(request.request_type)}</td>
              <td>{request.description}</td>
              <td>{translateRequestStatus(request.status)}</td>
              <td>{formatRequestDate(request.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
