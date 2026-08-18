import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { RequestStatus } from '../../types/request'
import type { RequestDetailsRequest } from '../../types/requestDetails'
import type { RequestReminderSummary } from '../../types/requestReminder'
import type { TeacherRequestReminderState } from '../../types/requestReminder'
import { canSendRequestReminder } from '../../services/requestReminders'
import { formatRequestDateTime } from '../../utils/requests'
import { Modal } from '../ui/Modal'
import { RequestReminderRowIndicator } from './RequestReminderRowIndicator'
import { RequestDetailsAttachmentsSection } from './RequestDetailsAttachmentsSection'
import { RequestDetailsConversationSection } from './RequestDetailsConversationSection'
import { RequestHandlerCell } from './RequestHandlerCell'
import { RequestHandlerHistorySection } from './RequestHandlerHistorySection'
import { RequestDetailsHistorySection } from './RequestDetailsHistorySection'
import { RequestDetailsNotesSection } from './RequestDetailsNotesSection'
import { RequestDetailsSummaryFields } from './RequestDetailsSummaryFields'
import type { PrimaryRole } from '../../types/user'
import type { RequestHandlerAssignedPatch } from '../../types/requestOwnership'
import './RequestDetailsModal.css'

type RequestDetailsModalProps = {
  isOpen: boolean
  request: RequestDetailsRequest | null
  onClose: () => void
  returnFocusElement?: HTMLElement | null
  hasAttachment?: boolean
  reminderSummary?: RequestReminderSummary
  teacherReminderState?: TeacherRequestReminderState
  hasUnreadReminder?: boolean
  onConversationOpened?: () => void
  actions?: ReactNode
  showHistory?: boolean
  showNotes?: boolean
  showAttachments?: boolean
  ownership?: {
    actorUserId: string
    actorRole: PrimaryRole
    institutionId?: string | null
    isBusy: boolean
    onClaim: (requestId: string) => void
    onAssigned: (patch: RequestHandlerAssignedPatch) => void
    onReleased: (requestId: string, status: RequestStatus) => void
    onError: (message: string, errorCode?: string) => void
  }
}

export function RequestDetailsModal({
  isOpen,
  request,
  onClose,
  returnFocusElement = null,
  hasAttachment,
  reminderSummary,
  teacherReminderState,
  hasUnreadReminder = false,
  onConversationOpened,
  actions,
  showHistory = true,
  showNotes = false,
  showAttachments = true,
  ownership,
}: RequestDetailsModalProps) {
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(null)
  const returnFocusRef = useRef(returnFocusElement)

  useEffect(() => {
    returnFocusRef.current = returnFocusElement
  }, [returnFocusElement])

  function handleClose() {
    setLastUpdateAt(null)
    onClose()
    const elementToFocus = returnFocusRef.current
    if (elementToFocus) {
      requestAnimationFrame(() => {
        elementToFocus.focus({ preventScroll: true })
      })
    }
  }

  if (!request) {
    return null
  }

  const title = `פרטי בקשה — ${request.description}`

  return (
    <Modal
      isOpen={isOpen}
      size="large"
      title={title}
      closeLabel="סגירת פרטי בקשה"
      onClose={handleClose}
    >
      <div className="request-details">
        {(reminderSummary || teacherReminderState) && (
          <section className="request-details__section" aria-label="תזכורות">
            <h3 className="request-details__section-title">תזכורות</h3>
            {reminderSummary ? (
              <div className="request-details__reminder">
                <RequestReminderRowIndicator
                  summary={reminderSummary}
                  hasUnreadReminder={hasUnreadReminder}
                  badgeClassName="request-details__reminder-badge"
                  metaClassName="request-details__reminder-meta"
                />
              </div>
            ) : null}
            {teacherReminderState ? (
              <dl className="request-details__summary">
                <div className="request-details__details-row">
                  <dt>מספר תזכורות שנשלחו</dt>
                  <dd>{teacherReminderState.reminder_count}</dd>
                </div>
                {teacherReminderState.last_reminder_at ? (
                  <div className="request-details__details-row">
                    <dt>תזכורת אחרונה</dt>
                    <dd>{formatRequestDateTime(teacherReminderState.last_reminder_at)}</dd>
                  </div>
                ) : null}
                {teacherReminderState.next_reminder_available_at &&
                canSendRequestReminder(request.status as RequestStatus) ? (
                  <div className="request-details__details-row">
                    <dt>תזכורת הבאה אפשרית מ-</dt>
                    <dd>{formatRequestDateTime(teacherReminderState.next_reminder_available_at)}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </section>
        )}

        <RequestDetailsSummaryFields request={request} lastUpdateAt={lastUpdateAt} />

        {request.role !== 'teacher' ? (
          <section className="request-details__section" aria-label="טיפול בבקשה">
            <h3 className="request-details__section-title">טיפול בבקשה</h3>
            {ownership ? (
              <RequestHandlerCell
                request={request}
                actorUserId={ownership.actorUserId}
                actorRole={ownership.actorRole}
                institutionId={ownership.institutionId}
                isBusy={ownership.isBusy}
                onClaim={ownership.onClaim}
                onAssigned={ownership.onAssigned}
                onReleased={ownership.onReleased}
                onError={ownership.onError}
              />
            ) : (
              <dl className="request-details__summary">
                <div className="request-details__details-row">
                  <dt>בטיפול של</dt>
                  <dd>
                    {request.handled_by_full_name?.trim()
                      ? request.handled_by_full_name
                      : 'לא הוקצתה מטפלת'}
                  </dd>
                </div>
              </dl>
            )}
          </section>
        ) : null}

        {showAttachments ? (
          <RequestDetailsAttachmentsSection
            requestId={request.id}
            isActive={isOpen}
            knownHasAttachment={hasAttachment}
          />
        ) : null}

        {showHistory ? (
          <RequestDetailsHistorySection
            key={`status-history-${request.id}`}
            requestId={request.id}
            isActive={isOpen}
            onLastUpdateLoaded={setLastUpdateAt}
          />
        ) : null}

        {request.role !== 'teacher' ? (
          <RequestHandlerHistorySection
            key={`handler-history-${request.id}`}
            requestId={request.id}
            isActive={isOpen}
          />
        ) : null}

        {showNotes ? (
          <RequestDetailsNotesSection requestId={request.id} isActive={isOpen} />
        ) : null}

        <RequestDetailsConversationSection
          requestId={request.id}
          isActive={isOpen}
          onConversationOpened={onConversationOpened}
        />

        {actions ? <footer className="request-details__actions">{actions}</footer> : null}
      </div>
    </Modal>
  )
}
