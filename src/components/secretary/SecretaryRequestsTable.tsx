import type { RequestStatus, SecretaryInboxRequest } from '../../types/request'
import type { RequestReminderSummary } from '../../types/requestReminder'
import { handleRequestRowActivate } from '../../utils/requestTableRowInteraction'
import {
  formatRequestDate,
  REQUEST_STATUS_OPTIONS,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'
import { RequestSubjectMessagePreview } from '../requests/RequestSubjectMessagePreview'
import { RequestDescriptionCell } from '../requests/RequestDescriptionCell'
import { RequestReminderRowIndicator } from '../requests/RequestReminderRowIndicator'
import { SecretaryRequestAttachmentCell } from './SecretaryRequestAttachmentCell'

type SecretaryRequestsTableProps = {
  requests: SecretaryInboxRequest[]
  emptyMessage: string
  updatingRequestId: string | null
  archivingRequestId: string | null
  requestIdsWithAttachments: ReadonlySet<string>
  unreadReminderRequestIds: ReadonlySet<string>
  reminderSummariesByRequestId: ReadonlyMap<string, RequestReminderSummary>
  highlightedRequestId?: string | null
  onStatusChange: (requestId: string, status: RequestStatus) => void
  onOpenDetails: (request: SecretaryInboxRequest, rowElement: HTMLTableRowElement) => void
  onArchive: (request: SecretaryInboxRequest) => void
}

function canArchiveRequest(status: RequestStatus): boolean {
  return status === 'completed' || status === 'rejected'
}

export function SecretaryRequestsTable({
  requests,
  emptyMessage,
  updatingRequestId,
  archivingRequestId,
  requestIdsWithAttachments,
  unreadReminderRequestIds,
  reminderSummariesByRequestId,
  highlightedRequestId = null,
  onStatusChange,
  onOpenDetails,
  onArchive,
}: SecretaryRequestsTableProps) {
  if (requests.length === 0) {
    return (
      <div className="ds-state secretary-dashboard__empty-state">
        <span className="ds-state__icon" aria-hidden="true">
          📥
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
            <th>תיאור</th>
            <th>סטטוס</th>
            <th>תאריך</th>
            <th>קובץ מצורף</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => {
            const isArchiving = archivingRequestId === request.id
            const showArchiveAction = canArchiveRequest(request.status)
            const reminderSummary = reminderSummariesByRequestId.get(request.id)
            const hasUnreadReminder = unreadReminderRequestIds.has(request.id)

            return (
            <tr
              key={request.id}
              data-request-id={request.id}
              className={[
                'ds-table__row--clickable',
                hasUnreadReminder
                  ? 'secretary-dashboard__row--reminder-received'
                  : highlightedRequestId === request.id
                    ? 'secretary-dashboard__row--reminder-received'
                    : '',
              ]
                .filter(Boolean)
                .join(' ')}
              tabIndex={0}
              onClick={(event) =>
                handleRequestRowActivate(event, (row) => onOpenDetails(request, row))
              }
              onKeyDown={(event) =>
                handleRequestRowActivate(event, (row) => onOpenDetails(request, row))
              }
            >
              <td>{request.teacher_full_name}</td>
              <td>{translateRequestType(request.request_type)}</td>
              <td>
                {request.request_type === 'general_request' ? (
                  <RequestSubjectMessagePreview
                    subject={request.description}
                    requestPayload={request.request_payload}
                  />
                ) : (
                  <RequestDescriptionCell description={request.description} />
                )}
              </td>
              <td>
                <div className="secretary-dashboard__status-cell">
                  <RequestReminderRowIndicator
                    summary={reminderSummary}
                    hasUnreadReminder={hasUnreadReminder}
                    badgeClassName="secretary-dashboard__reminder-badge"
                    metaClassName="secretary-dashboard__reminder-meta"
                  />
                  <div className="secretary-dashboard__status-control">
                  <span className={`ds-table__status ds-table__status--${request.status}`}>
                    {translateRequestStatus(request.status)}
                  </span>
                  <select
                    className="secretary-dashboard__input secretary-dashboard__status-select"
                    value={request.status}
                    onChange={(e) =>
                      onStatusChange(request.id, e.target.value as RequestStatus)
                    }
                    disabled={updatingRequestId === request.id || archivingRequestId !== null}
                    aria-label={`סטטוס בקשה של ${request.teacher_full_name}`}
                  >
                    {REQUEST_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                </div>
              </td>
              <td>{formatRequestDate(request.created_at)}</td>
              <td>
                <SecretaryRequestAttachmentCell
                  requestId={request.id}
                  hasAttachment={requestIdsWithAttachments.has(request.id)}
                />
              </td>
              <td>
                <div className="ds-table__row-actions secretary-dashboard__row-actions">
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary secretary-dashboard__history-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenDetails(request, event.currentTarget.closest('tr') as HTMLTableRowElement)
                    }}
                  >
                    היסטוריה
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary secretary-dashboard__notes-button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenDetails(request, event.currentTarget.closest('tr') as HTMLTableRowElement)
                    }}
                  >
                    הערות
                  </button>
                  {showArchiveAction && (
                    <button
                      type="button"
                      className="ds-btn ds-btn--secondary"
                      onClick={() => onArchive(request)}
                      disabled={archivingRequestId !== null}
                    >
                      {isArchiving ? 'מעביר...' : 'העבר לארכיון'}
                    </button>
                  )}
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
