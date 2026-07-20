import { useId, useMemo, useState } from 'react'
import type { MeetingCalendarRole, MeetingDurationMinutes } from '../../types/meetingCalendar'
import {
  createMeeting,
  proposeMeetingSlots,
} from '../../services/meetingCalendar'
import {
  MEETING_REASON_MAX_LENGTH,
  MEETING_SUBJECT_MAX_LENGTH,
  mapMeetingCalendarError,
  searchMeetingRecipients,
  willRequesterBeCalendarOwner,
  type MeetingUserDirectoryEntry,
} from '../../utils/meetingCalendarDisplay'
import {
  createEmptySlotDraft,
  draftSlotsToProposedInputs,
  MEETING_DURATION_OPTIONS,
  validateCreateMeetingForm,
  type SlotDraft,
} from '../../utils/meetingCalendarForm'
import { translateRole } from '../../utils/roles'
import { Modal } from '../ui/Modal'
import { MeetingProposeSlotsForm } from './MeetingProposeSlotsForm'
import './MeetingCalendar.css'

type CreateMeetingModalProps = {
  isOpen: boolean
  actorRole: MeetingCalendarRole
  eligibleRecipients: MeetingUserDirectoryEntry[]
  onClose: () => void
  onCreated: () => void
}

type CreateMeetingModalFormProps = {
  actorRole: MeetingCalendarRole
  eligibleRecipients: MeetingUserDirectoryEntry[]
  onClose: () => void
  onCreated: () => void
}

function CreateMeetingModalForm({
  actorRole,
  eligibleRecipients,
  onClose,
  onCreated,
}: CreateMeetingModalFormProps) {
  const subjectId = useId()
  const reasonId = useId()
  const recipientSearchId = useId()
  const recipientListId = useId()

  const [recipient, setRecipient] = useState<MeetingUserDirectoryEntry | null>(null)
  const [recipientQuery, setRecipientQuery] = useState('')
  const [subject, setSubject] = useState('')
  const [reason, setReason] = useState('')
  const [durationMinutes, setDurationMinutes] = useState<MeetingDurationMinutes | null>(null)
  const [slotDrafts, setSlotDrafts] = useState<SlotDraft[]>([createEmptySlotDraft()])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationMessage, setValidationMessage] = useState('')
  const [slotsValidationMessage, setSlotsValidationMessage] = useState('')

  const isOwnerInitiated = useMemo(() => {
    if (!recipient) {
      return false
    }
    return willRequesterBeCalendarOwner(actorRole, recipient.primaryRole)
  }, [actorRole, recipient])

  const filteredRecipients = useMemo(
    () => searchMeetingRecipients(eligibleRecipients, recipientQuery),
    [eligibleRecipients, recipientQuery],
  )

  function selectRecipient(selected: MeetingUserDirectoryEntry) {
    setRecipient(selected)
    setRecipientQuery('')
    setDurationMinutes(null)
    setSlotDrafts([createEmptySlotDraft()])
  }

  function clearRecipient() {
    setRecipient(null)
    setRecipientQuery('')
  }

  async function handleSubmit() {
    setValidationMessage('')
    setSlotsValidationMessage('')

    const validation = validateCreateMeetingForm({
      recipientId: recipient?.id ?? '',
      subject,
      reason,
      durationMinutes,
      requireDuration: isOwnerInitiated,
    })

    if (!validation.ok) {
      setValidationMessage(validation.errorMessage)
      return
    }

    if (!recipient) {
      setValidationMessage('נא לבחור נמען.')
      return
    }

    let slotsPayload: ReturnType<typeof draftSlotsToProposedInputs> | null = null
    if (isOwnerInitiated) {
      if (validation.durationMinutes === null) {
        setValidationMessage('נא לבחור משך פגישה.')
        return
      }
      slotsPayload = draftSlotsToProposedInputs(slotDrafts, validation.durationMinutes)
      if (!slotsPayload.ok) {
        setSlotsValidationMessage(slotsPayload.errorMessage)
        return
      }
    }

    setIsSubmitting(true)

    const createResult = await createMeeting({
      recipientId: recipient.id,
      subject: validation.subject,
      reason: validation.reason,
      durationMinutes: isOwnerInitiated
        ? (validation.durationMinutes as MeetingDurationMinutes)
        : null,
    })

    if (!createResult.ok) {
      setValidationMessage(mapMeetingCalendarError(createResult.errorMessage))
      setIsSubmitting(false)
      return
    }

    if (isOwnerInitiated && slotsPayload?.ok && createResult.meetingId) {
      const proposeResult = await proposeMeetingSlots(
        createResult.meetingId,
        slotsPayload.slots,
        validation.durationMinutes as MeetingDurationMinutes,
      )
      if (!proposeResult.ok) {
        setValidationMessage(mapMeetingCalendarError(proposeResult.errorMessage))
        setIsSubmitting(false)
        onCreated()
        return
      }
    }

    setIsSubmitting(false)
    onCreated()
    onClose()
  }

  return (
    <div className="mc-create-form" aria-busy={isSubmitting}>
      <p className="mc-help-text">תאם פגישה חדשה עם משתמש במוסד.</p>

      <div className="mc-field-block">
        <p className="mc-field-label" id="mc-create-recipient-label">
          עם מי תרצה להיפגש?
        </p>

        {recipient ? (
          <>
            <p className="mc-selected-recipient">
              {recipient.fullName} · {translateRole(recipient.primaryRole)}
            </p>
            <div className="mc-actions">
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                onClick={clearRecipient}
                disabled={isSubmitting}
              >
                שינוי
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="ds-field" htmlFor={recipientSearchId}>
              <span className="ds-label">חיפוש לפי שם</span>
              <input
                id={recipientSearchId}
                className="ds-input"
                type="search"
                value={recipientQuery}
                onChange={(event) => setRecipientQuery(event.target.value)}
                placeholder="הקלידו שם משתמש"
                autoComplete="off"
                disabled={isSubmitting}
              />
            </label>

            <div
              id={recipientListId}
              className="mc-recipient-list"
              role="radiogroup"
              aria-labelledby="mc-create-recipient-label"
            >
              {filteredRecipients.length === 0 ? (
                <p className="ds-empty-state">לא נמצאו נמענים מתאימים.</p>
              ) : (
                filteredRecipients.map((entry) => {
                  const inputId = `${recipientListId}-${entry.id}`
                  return (
                    <label key={entry.id} className="mc-recipient-option" htmlFor={inputId}>
                      <input
                        id={inputId}
                        type="radio"
                        name="create-meeting-recipient"
                        disabled={isSubmitting}
                        onChange={() => selectRecipient(entry)}
                      />
                      <span className="mc-recipient-option__body">
                        <strong>{entry.fullName}</strong>
                        <span>{translateRole(entry.primaryRole)}</span>
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>

      <div className="mc-field-block">
        <p className="mc-field-label">פרטי הפגישה</p>

        <label className="ds-field" htmlFor={subjectId}>
          <span className="ds-label">נושא</span>
          <input
            id={subjectId}
            className="ds-input"
            value={subject}
            maxLength={MEETING_SUBJECT_MAX_LENGTH}
            disabled={isSubmitting}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>

        <label className="ds-field" htmlFor={reasonId}>
          <span className="ds-label">סיבה</span>
          <textarea
            id={reasonId}
            className="ds-textarea"
            value={reason}
            maxLength={MEETING_REASON_MAX_LENGTH}
            rows={5}
            disabled={isSubmitting}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <p className="ds-helper-text" aria-live="polite">
          {reason.length}/{MEETING_REASON_MAX_LENGTH}
        </p>
      </div>

      {isOwnerInitiated ? (
        <div className="mc-owner-propose">
          <div className="mc-field-block">
            <p className="mc-field-label">משך הפגישה</p>
            <div
              className="mc-calendar-board__modes"
              role="radiogroup"
              aria-label="משך הפגישה בדקות"
            >
              {MEETING_DURATION_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={durationMinutes === option}
                  className={`ds-btn ${
                    durationMinutes === option ? 'ds-btn--primary' : 'ds-btn--secondary'
                  }`}
                  disabled={isSubmitting}
                  onClick={() => setDurationMinutes(option)}
                >
                  {option} דקות
                </button>
              ))}
            </div>
          </div>

          {durationMinutes ? (
            <MeetingProposeSlotsForm
              durationMinutes={durationMinutes}
              drafts={slotDrafts}
              onDraftsChange={setSlotDrafts}
              validationMessage={slotsValidationMessage}
            />
          ) : null}
        </div>
      ) : (
        <p className="mc-help-text">משך הפגישה והמועדים ייקבעו על ידי בעל היומן.</p>
      )}

      {validationMessage ? (
        <p className="ds-form-message ds-form-message--error" role="alert">
          {validationMessage}
        </p>
      ) : null}

      <div className="mc-actions">
        <button
          type="button"
          className="ds-btn ds-btn--secondary"
          onClick={onClose}
          disabled={isSubmitting}
        >
          ביטול
        </button>
        <button
          type="button"
          className="ds-btn ds-btn--primary"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'שולח…' : isOwnerInitiated ? 'שליחת הזמנה' : 'שליחת בקשה'}
        </button>
      </div>
    </div>
  )
}

export function CreateMeetingModal({
  isOpen,
  actorRole,
  eligibleRecipients,
  onClose,
  onCreated,
}: CreateMeetingModalProps) {
  return (
    <Modal isOpen={isOpen} title="יצירת פגישה חדשה" onClose={onClose} size="large">
      {isOpen ? (
        <CreateMeetingModalForm
          actorRole={actorRole}
          eligibleRecipients={eligibleRecipients}
          onClose={onClose}
          onCreated={onCreated}
        />
      ) : null}
    </Modal>
  )
}
