import type { SecretaryArchivedRequest } from '../../types/request'
import { handleRequestRowActivate } from '../../utils/requestTableRowInteraction'
import {
  formatRequestDate,
  formatRequestDateTime,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'
import { RequestConversationRowIndicator } from '../requests/RequestConversationRowIndicator'

type SecretaryArchiveTableProps = {
  requests: SecretaryArchivedRequest[]
  emptyMessage: string
  unreadMessageRequestIds?: ReadonlySet<string>
  requestIdsWithMessages?: ReadonlySet<string>
  onOpenDetails?: (request: SecretaryArchivedRequest, rowElement: HTMLTableRowElement) => void
}

export function SecretaryArchiveTable({
  requests,
  emptyMessage,
  unreadMessageRequestIds = new Set(),
  requestIdsWithMessages = new Set(),
  onOpenDetails,
}: SecretaryArchiveTableProps) {
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

  const isRowClickable = Boolean(onOpenDetails)

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
          {requests.map((request) => {
            const hasUnreadConversation = unreadMessageRequestIds.has(request.id)
            const hasConversation = requestIdsWithMessages.has(request.id)

            return (
              <tr
                key={request.id}
                data-request-id={request.id}
                className={[
                  isRowClickable ? 'ds-table__row--clickable' : '',
                  hasUnreadConversation ? 'ds-table__row--unread-conversation' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                tabIndex={isRowClickable ? 0 : undefined}
                onClick={
                  onOpenDetails
                    ? (event) =>
                        handleRequestRowActivate(event, (row) => onOpenDetails(request, row))
                    : undefined
                }
                onKeyDown={
                  onOpenDetails
                    ? (event) =>
                        handleRequestRowActivate(event, (row) => onOpenDetails(request, row))
                    : undefined
                }
              >
                <td>{request.teacher_full_name}</td>
                <td>{translateRequestType(request.request_type)}</td>
                <td>
                  <div className="request-row__status-cell">
                    <RequestConversationRowIndicator
                      hasConversation={hasConversation}
                      hasUnreadConversation={hasUnreadConversation}
                    />
                    <span className={`ds-table__status ds-table__status--${request.status}`}>
                      {translateRequestStatus(request.status)}
                    </span>
                  </div>
                </td>
                <td>{formatRequestDate(request.created_at)}</td>
                <td>{formatRequestDateTime(request.archived_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
