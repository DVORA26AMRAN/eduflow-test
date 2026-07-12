import type { ManagerRecentRequest } from '../../types/analytics'
import type { RequestReminderSummary } from '../../types/requestReminder'
import {
  formatRequestDate,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'
import { RequestDescriptionCell } from '../requests/RequestDescriptionCell'
import { RequestReminderRowIndicator } from '../requests/RequestReminderRowIndicator'
import { RequestArchiveTrashButton } from '../requests/RequestArchiveTrashButton'

type ManagerRecentRequestsTableProps = {
  requests: ManagerRecentRequest[]
  archivingRequestId: string | null
  unreadReminderRequestIds: ReadonlySet<string>
  reminderSummariesByRequestId: ReadonlyMap<string, RequestReminderSummary>
  highlightedRequestId?: string | null
  onArchive: (request: ManagerRecentRequest) => void
}

export function ManagerRecentRequestsTable({
  requests,
  archivingRequestId,
  unreadReminderRequestIds,
  reminderSummariesByRequestId,
  highlightedRequestId = null,
  onArchive,
}: ManagerRecentRequestsTableProps) {
  return (
    <div className="ds-table-wrapper manager-dashboard__table-wrapper">
      <table className="ds-table">
        <thead>
          <tr>
            <th>מורה</th>
            <th>סוג בקשה</th>
            <th>תיאור</th>
            <th>סטטוס</th>
            <th>תאריך</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => {
            const reminderSummary = reminderSummariesByRequestId.get(request.id)
            const hasUnreadReminder = unreadReminderRequestIds.has(request.id)

            return (
            <tr
              key={request.id}
              data-request-id={request.id}
              className={
                hasUnreadReminder
                  ? 'manager-dashboard__row--reminder-received'
                  : highlightedRequestId === request.id
                    ? 'manager-dashboard__row--reminder-received'
                    : undefined
              }
            >
              <td>{request.teacher_full_name}</td>
              <td>{translateRequestType(request.request_type)}</td>
              <td>
                <RequestDescriptionCell description={request.description} />
              </td>
              <td>
                <RequestReminderRowIndicator
                  summary={reminderSummary}
                  hasUnreadReminder={hasUnreadReminder}
                  badgeClassName="manager-dashboard__reminder-badge"
                  metaClassName="manager-dashboard__reminder-meta"
                />
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
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
