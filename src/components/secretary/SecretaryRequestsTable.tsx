import type { RequestStatus, SecretaryInboxRequest } from '../../types/request'
import {
  formatRequestDate,
  REQUEST_STATUS_OPTIONS,
  translateRequestType,
} from '../../utils/requests'
import { SecretaryRequestAttachmentCell } from './SecretaryRequestAttachmentCell'

type SecretaryRequestsTableProps = {
  requests: SecretaryInboxRequest[]
  emptyMessage: string
  updatingRequestId: string | null
  requestIdsWithAttachments: ReadonlySet<string>
  onStatusChange: (requestId: string, status: RequestStatus) => void
  onShowHistory: (requestId: string) => void
}

export function SecretaryRequestsTable({
  requests,
  emptyMessage,
  updatingRequestId,
  requestIdsWithAttachments,
  onStatusChange,
  onShowHistory,
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
            <th>קובץ מצורף</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td>{request.teacher_full_name}</td>
              <td>{translateRequestType(request.request_type)}</td>
              <td>{request.description}</td>
              <td>
                <select
                  className="secretary-dashboard__input secretary-dashboard__status-select"
                  value={request.status}
                  onChange={(e) =>
                    onStatusChange(request.id, e.target.value as RequestStatus)
                  }
                  disabled={updatingRequestId === request.id}
                  aria-label={`סטטוס בקשה של ${request.teacher_full_name}`}
                >
                  {REQUEST_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>{formatRequestDate(request.created_at)}</td>
              <td>
                <SecretaryRequestAttachmentCell
                  requestId={request.id}
                  hasAttachment={requestIdsWithAttachments.has(request.id)}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary secretary-dashboard__history-button"
                  onClick={() => onShowHistory(request.id)}
                >
                  היסטוריה
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
