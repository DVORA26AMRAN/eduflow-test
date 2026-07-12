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
import { RequestDetailsHistorySection } from './RequestDetailsHistorySection'
import { RequestDetailsNotesSection } from './RequestDetailsNotesSection'
import { RequestDetailsSummaryFields } from './RequestDetailsSummaryFields'
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

        {showAttachments ? (
          <RequestDetailsAttachmentsSection
            requestId={request.id}
            isActive={isOpen}
            knownHasAttachment={hasAttachment}
          />
        ) : null}

        {showHistory ? (
          <RequestDetailsHistorySection
            key={request.id}
            requestId={request.id}
            isActive={isOpen}
            onLastUpdateLoaded={setLastUpdateAt}
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
