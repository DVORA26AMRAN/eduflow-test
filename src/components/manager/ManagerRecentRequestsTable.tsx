import type { ManagerRecentRequest } from '../../types/analytics'
import {
  formatRequestDate,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'
import { RequestArchiveTrashButton } from '../requests/RequestArchiveTrashButton'

type ManagerRecentRequestsTableProps = {
  requests: ManagerRecentRequest[]
  archivingRequestId: string | null
  onArchive: (request: ManagerRecentRequest) => void
}

export function ManagerRecentRequestsTable({
  requests,
  archivingRequestId,
  onArchive,
}: ManagerRecentRequestsTableProps) {
  return (
    <div className="ds-table-wrapper manager-dashboard__table-wrapper">
      <table className="ds-table">
        <thead>
          <tr>
            <th>מורה</th>
            <th>סוג בקשה</th>
            <th>סטטוס</th>
            <th>תאריך</th>
            <th>פעולות</th>
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
              <td>
                <div className="ds-table__row-actions">
                  <RequestArchiveTrashButton
                    teacherName={request.teacher_full_name}
                    isArchiving={archivingRequestId === request.id}
                    isDisabled={archivingRequestId !== null && archivingRequestId !== request.id}
                    onArchive={() => onArchive(request)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
