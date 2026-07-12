import type { ArchivedTeacherRequest } from '../../types/request'
import {
  formatRequestDate,
  formatRequestDateTime,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'
import { RequestConversationRowIndicator } from '../requests/RequestConversationRowIndicator'

type TeacherArchiveListProps = {
  requests: ArchivedTeacherRequest[]
  selectedRequestId: string | null
  emptyMessage: string
  unreadMessageRequestIds?: ReadonlySet<string>
  requestIdsWithMessages?: ReadonlySet<string>
  onSelect: (requestId: string) => void
}

export function TeacherArchiveList({
  requests,
  selectedRequestId,
  emptyMessage,
  unreadMessageRequestIds = new Set(),
  requestIdsWithMessages = new Set(),
  onSelect,
}: TeacherArchiveListProps) {
  if (requests.length === 0) {
    return (
      <div className="ds-state teacher-dashboard__empty-state">
        <span className="ds-state__icon" aria-hidden="true">
          🗄️
        </span>
        <p className="ds-state__title">{emptyMessage}</p>
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
            <th>תאריך יצירה</th>
            <th>תאריך ארכוב</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => {
            const isSelected = selectedRequestId === request.id
            const hasUnreadConversation = unreadMessageRequestIds.has(request.id)
            const hasConversation = requestIdsWithMessages.has(request.id)

            return (
              <tr
                key={request.id}
                className={hasUnreadConversation ? 'ds-table__row--unread-conversation' : ''}
              >
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
                <td>
                  <div className="ds-table__row-actions">
                    <button
                      type="button"
                      className={
                        isSelected
                          ? 'ds-btn ds-btn--primary teacher-dashboard__archive-details-button'
                          : 'ds-btn ds-btn--secondary teacher-dashboard__archive-details-button'
                      }
                      onClick={() => onSelect(request.id)}
                      aria-pressed={isSelected}
                    >
                      פרטים
                    </button>
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
