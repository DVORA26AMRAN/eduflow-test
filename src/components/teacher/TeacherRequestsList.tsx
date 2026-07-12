import type { TeacherRequest } from '../../types/request'
import type { TeacherRequestReminderState } from '../../types/requestReminder'
import { canSendRequestReminder } from '../../services/requestReminders'
import { handleRequestRowActivate } from '../../utils/requestTableRowInteraction'
import { RequestReminderBellButton } from '../requests/RequestReminderBellButton'
import { translateRecipientRole } from '../../utils/generalRequestDisplay'
import {
  formatRequestDate,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'

type TeacherRequestsListProps = {
  requests: TeacherRequest[]
  archivingRequestId: string | null
  remindingRequestId: string | null
  reminderStatesByRequestId: ReadonlyMap<string, TeacherRequestReminderState>
  onArchive: (request: TeacherRequest) => void
  onSendReminder: (request: TeacherRequest) => void
  onOpenDetails: (request: TeacherRequest, rowElement: HTMLTableRowElement) => void
}

export function TeacherRequestsList({
  requests,
  archivingRequestId,
  remindingRequestId,
  reminderStatesByRequestId,
  onArchive,
  onSendReminder,
  onOpenDetails,
}: TeacherRequestsListProps) {
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
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => {
            const isArchiving = archivingRequestId === request.id
            const isReminding = remindingRequestId === request.id
            const reminderState = reminderStatesByRequestId.get(request.id)
            const isCooldownActive = Boolean(reminderState?.next_reminder_available_at)
            const showReminderBell = canSendRequestReminder(request.status)

            return (
              <tr
                key={request.id}
                data-request-id={request.id}
                className="ds-table__row--clickable"
                tabIndex={0}
                onClick={(event) => handleRequestRowActivate(event, (row) => onOpenDetails(request, row))}
                onKeyDown={(event) => handleRequestRowActivate(event, (row) => onOpenDetails(request, row))}
              >
                <td>{translateRequestType(request.request_type)}</td>
                <td>
                  <span className={`ds-table__status ds-table__status--${request.status}`}>
                    {translateRequestStatus(request.status)}
                  </span>
                </td>
                <td>{formatRequestDate(request.created_at)}</td>
                <td>
                  {request.request_type === 'general_request' && request.recipient_role ? (
                    <div className="teacher-dashboard__request-summary">
                      <span className="teacher-dashboard__request-recipient">
                        נמען: {translateRecipientRole(request.recipient_role)}
                      </span>
                      <span>{request.description}</span>
                    </div>
                  ) : (
                    request.description
                  )}
                </td>
                <td>
                  <div className="ds-table__row-actions">
                    <RequestReminderBellButton
                      requestStatus={request.status}
                      isVisible={showReminderBell}
                      isDisabled={
                        archivingRequestId !== null ||
                        remindingRequestId !== null ||
                        isCooldownActive
                      }
                      isSending={isReminding}
                      disabledReason={
                        isCooldownActive
                          ? 'ניתן לשלוח תזכורת נוספת רק לאחר תקופת ההמתנה'
                          : undefined
                      }
                      onSendReminder={() => onSendReminder(request)}
                    />
                    <button
                      type="button"
                      className="ds-btn ds-btn--secondary"
                      onClick={() => onArchive(request)}
                      disabled={archivingRequestId !== null || remindingRequestId !== null}
                    >
                      {isArchiving ? 'מעביר...' : 'העבר לארכיון'}
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
