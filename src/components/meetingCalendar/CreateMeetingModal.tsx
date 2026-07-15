import { useEffect, useId, useMemo, useState } from 'react'
import type { MeetingCalendarRole, MeetingDurationMinutes } from '../../types/meetingCalendar'
import {
  createMeeting,
  proposeMeetingSlots,
} from '../../services/meetingCalendar'
import {
  MEETING_REASON_MAX_LENGTH,
  MEETING_SUBJECT_MAX_LENGTH,
  mapMeetingCalendarError,
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
import { MeetingRecipientPicker } from './MeetingRecipientPicker'
import './MeetingCalendar.css'

type CreateMeetingModalProps = {
  isOpen: boolean
  actorRole: MeetingCalendarRole
  eligibleRecipients: MeetingUserDirectoryEntry[]
  onClose: () => void
  onCreated: () => void
}

export function CreateMeetingModal({
  isOpen,
  actorRole,
  eligibleRecipients,
  onClose,
  onCreated,
}: CreateMeetingModalProps) {
  const subjectId = useId()
  const reasonId = useId()
  const durationId = useId()

  const [recipient, setRecipient] = useState<MeetingUserDirectoryEntry | null>(null)
  const [subject, setSubject] = useState('')
  const [reason, setReason] = useState('')
  const [durationMinutes, setDurationMinutes] = useState<MeetingDurationMinutes | null>(null)
  const [slotDrafts, setSlotDrafts] = useState<SlotDraft[]>([createEmptySlotDraft()])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationMessage, setValidationMessage] = useState('')
  const [slotsValidationMessage, setSlotsValidationMessage] = useState('')

  const isOwnerInitiated = useMemo(() => {
    if (!recipient) {
      return false
    }
    return willRequesterBeCalendarOwner(actorRole, recipient.primaryRole)
  }, [actorRole, recipient])

  useEffect(() => {
    if (!isOpen) {
      setRecipient(null)
      setSubject('')
      setReason('')
      setDurationMinutes(null)
      setSlotDrafts([createEmptySlotDraft()])
      setValidationMessage('')
      setSlotsValidationMessage('')
      setPickerOpen(false)
      setIsSubmitting(false)
    }
  }, [isOpen])

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
    <>
      <Modal isOpen={isOpen} title="יצירת פגישה חדשה" onClose={onClose} size="large">
        <div className="mc-create-form">
          <div className="mc-field-block">
            <p className="mc-field-label">נמען</p>
            <p className="mc-selected-recipient">
              {recipient
                ? `${recipient.fullName} · ${translateRole(recipient.primaryRole)}`
                : 'לא נבחר נמען'}
            </p>
            <button
              type="button"
              className="ds-button ds-button--secondary"
              onClick={() => setPickerOpen(true)}
            >
              בחירת נמען
            </button>
          </div>

          <label className="ds-field" htmlFor={subjectId}>
            <span>נושא</span>
            <input
              id={subjectId}
              value={subject}
              maxLength={MEETING_SUBJECT_MAX_LENGTH}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>

          <label className="ds-field" htmlFor={reasonId}>
            <span>סיבה</span>
            <textarea
              id={reasonId}
              value={reason}
              maxLength={MEETING_REASON_MAX_LENGTH}
              rows={4}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>

          {isOwnerInitiated ? (
            <>
              <label className="ds-field" htmlFor={durationId}>
                <span>משך הפגישה</span>
                <select
                  id={durationId}
                  value={durationMinutes ?? ''}
                  onChange={(event) =>
                    setDurationMinutes(
                      event.target.value
                        ? (Number(event.target.value) as MeetingDurationMinutes)
                        : null,
                    )
                  }
                >
                  <option value="">בחרו משך</option>
                  {MEETING_DURATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option} דקות
                    </option>
                  ))}
                </select>
              </label>

              {durationMinutes ? (
                <MeetingProposeSlotsForm
                  durationMinutes={durationMinutes}
                  drafts={slotDrafts}
                  onDraftsChange={setSlotDrafts}
                  validationMessage={slotsValidationMessage}
                />
              ) : null}
            </>
          ) : (
            <p className="mc-help-text">
              בקשה זו תישלח לבעל היומן לאישור. משך הפגישה והמועדים ייקבעו על ידו.
            </p>
          )}

          {validationMessage ? (
            <p className="ds-form-message ds-form-message--error" role="alert">
              {validationMessage}
            </p>
          ) : null}

          <div className="mc-actions">
            <button
              type="button"
              className="ds-button ds-button--secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              ביטול
            </button>
            <button
              type="button"
              className="ds-button"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'שולח…' : isOwnerInitiated ? 'שליחת הצעת מועדים' : 'שליחת בקשה'}
            </button>
          </div>
        </div>
      </Modal>

      <MeetingRecipientPicker
        isOpen={pickerOpen}
        recipients={eligibleRecipients}
        selectedRecipientId={recipient?.id ?? null}
        onClose={() => setPickerOpen(false)}
        onSelect={(selected) => {
          setRecipient(selected)
          setDurationMinutes(null)
          setSlotDrafts([createEmptySlotDraft()])
          setPickerOpen(false)
        }}
      />
    </>
  )
}
