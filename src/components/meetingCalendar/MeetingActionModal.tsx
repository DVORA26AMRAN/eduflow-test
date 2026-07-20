import { useEffect, useId, useState } from 'react'
import type { Meeting, MeetingDurationMinutes, MeetingSlot } from '../../types/meetingCalendar'
import {
  approveMeetingByOwner,
  confirmMeeting,
  loadMeetingSlots,
  proposeMeetingSlots,
  selectMeetingSlot,
  setMeetingDuration,
} from '../../services/meetingCalendar'
import {
  formatMeetingSlotRange,
  getMeetingParticipantLabel,
  mapMeetingCalendarError,
  translateMeetingDuration,
  translateMeetingState,
  type MeetingUserDirectoryEntry,
} from '../../utils/meetingCalendarDisplay'
import {
  createEmptySlotDraft,
  draftSlotsToProposedInputs,
  MEETING_DURATION_OPTIONS,
  type SlotDraft,
} from '../../utils/meetingCalendarForm'
import { Modal } from '../ui/Modal'
import { MeetingHistoryList } from './MeetingHistoryList'
import { MeetingProposeSlotsForm } from './MeetingProposeSlotsForm'
import './MeetingCalendar.css'

type MeetingActionModalProps = {
  isOpen: boolean
  meeting: Meeting | null
  actorUserId: string
  directory: Map<string, MeetingUserDirectoryEntry>
  onClose: () => void
  onChanged: () => void
}

export function MeetingActionModal({
  isOpen,
  meeting,
  actorUserId,
  directory,
  onClose,
  onChanged,
}: MeetingActionModalProps) {
  const durationId = useId()
  const [slots, setSlots] = useState<MeetingSlot[]>([])
  const [isLoadingSlots, setIsLoadingSlots] = useState(true)
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(
    meeting?.pendingSlotId ?? null,
  )
  const [durationMinutes, setDurationMinutes] = useState<MeetingDurationMinutes | null>(
    meeting?.durationMinutes ?? null,
  )
  const [slotDrafts, setSlotDrafts] = useState<SlotDraft[]>([createEmptySlotDraft()])
  const [message, setMessage] = useState('')
  const [slotsValidationMessage, setSlotsValidationMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [syncedDuration, setSyncedDuration] = useState(meeting?.durationMinutes ?? null)
  const [syncedPendingSlotId, setSyncedPendingSlotId] = useState(meeting?.pendingSlotId ?? null)

  if (
    meeting &&
    (meeting.durationMinutes !== syncedDuration ||
      meeting.pendingSlotId !== syncedPendingSlotId)
  ) {
    setSyncedDuration(meeting.durationMinutes)
    setSyncedPendingSlotId(meeting.pendingSlotId)
    setDurationMinutes(meeting.durationMinutes)
    setSelectedSlotId(meeting.pendingSlotId)
  }

  useEffect(() => {
    if (!isOpen || !meeting) {
      return
    }

    const meetingId = meeting.id
    const proposalCycle = meeting.activeProposalCycle
    const confirmedSlotId = meeting.confirmedSlotId
    let cancelled = false

    void loadMeetingSlots(meetingId).then((result) => {
      if (cancelled) {
        return
      }
      setIsLoadingSlots(false)
      if (!result.ok) {
        setMessage(result.errorMessage)
        return
      }
      const active = result.slots.filter(
        (slot) =>
          (slot.proposalCycle === proposalCycle &&
            (slot.slotStatus === 'proposed' ||
              slot.slotStatus === 'selected' ||
              slot.slotStatus === 'confirmed')) ||
          slot.id === confirmedSlotId,
      )
      setSlots(active)
    })

    return () => {
      cancelled = true
    }
  }, [isOpen, meeting])

  if (!meeting) {
    return null
  }

  const activeMeeting = meeting

  const otherParticipantId =
    activeMeeting.requesterId === actorUserId ? activeMeeting.recipientId : activeMeeting.requesterId
  const isCalendarOwner = activeMeeting.calendarOwnerId === actorUserId
  const isNonOwner = actorUserId !== activeMeeting.calendarOwnerId
  const proposedSlots = slots.filter((slot) => slot.slotStatus === 'proposed')
  const selectedSlot =
    slots.find((slot) => slot.id === (selectedSlotId ?? activeMeeting.pendingSlotId)) ?? null
  const confirmedSlot = slots.find((slot) => slot.id === activeMeeting.confirmedSlotId) ?? null

  async function refreshAfterChange() {
    onChanged()
  }

  async function handleApprove() {
    setIsSubmitting(true)
    setMessage('')
    const result = await approveMeetingByOwner(activeMeeting.id)
    setIsSubmitting(false)
    if (!result.ok) {
      setMessage(mapMeetingCalendarError(result.errorMessage))
      onChanged()
      return
    }
    await refreshAfterChange()
  }

  const isRescheduleFlow =
    activeMeeting.currentState === 'CONFIRMED' && activeMeeting.reschedulingActive
  const canProposeSlots =
    isCalendarOwner &&
    (activeMeeting.currentState === 'WAITING_FOR_SLOT_PROPOSAL' ||
      (isRescheduleFlow && !activeMeeting.pendingSlotId))
  const canSelectSlots =
    isNonOwner &&
    (activeMeeting.currentState === 'WAITING_FOR_SLOT_SELECTION' ||
      (isRescheduleFlow && !activeMeeting.pendingSlotId && proposedSlots.length > 0))
  const canFinalConfirm =
    isNonOwner &&
    (activeMeeting.currentState === 'WAITING_FOR_FINAL_CONFIRMATION' ||
      (isRescheduleFlow &&
        Boolean(activeMeeting.pendingSlotId) &&
        activeMeeting.slotSelectedByUserId === actorUserId))

  async function handlePropose() {
    setSlotsValidationMessage('')
    setMessage('')
    if (!durationMinutes) {
      setSlotsValidationMessage('נא לבחור משך פגישה.')
      return
    }

    const built = draftSlotsToProposedInputs(slotDrafts, durationMinutes)
    if (!built.ok) {
      setSlotsValidationMessage(built.errorMessage)
      return
    }

    setIsSubmitting(true)

    // Duration may only be set in WAITING_FOR_SLOT_PROPOSAL (not during reschedule).
    if (
      !isRescheduleFlow &&
      (activeMeeting.durationMinutes === null ||
        durationMinutes !== activeMeeting.durationMinutes)
    ) {
      const durationResult = await setMeetingDuration(activeMeeting.id, durationMinutes)
      if (!durationResult.ok) {
        setIsSubmitting(false)
        setMessage(mapMeetingCalendarError(durationResult.errorMessage))
        onChanged()
        return
      }
    }

    const proposeResult = await proposeMeetingSlots(activeMeeting.id, built.slots, durationMinutes)
    setIsSubmitting(false)
    if (!proposeResult.ok) {
      setMessage(mapMeetingCalendarError(proposeResult.errorMessage))
      onChanged()
      return
    }

    onChanged()
    onClose()
  }

  async function handleSelectOnly() {
    if (!selectedSlotId) {
      setMessage('נא לבחור מועד אחד.')
      return
    }
    setIsSubmitting(true)
    setMessage('')
    const result = await selectMeetingSlot(activeMeeting.id, selectedSlotId)
    setIsSubmitting(false)
    if (!result.ok) {
      setMessage(mapMeetingCalendarError(result.errorMessage))
      onChanged()
      return
    }
    onChanged()
  }

  async function handleFinalConfirm() {
    setIsSubmitting(true)
    setMessage('')

    const needsSelectBeforeConfirm =
      activeMeeting.currentState === 'WAITING_FOR_SLOT_SELECTION' ||
      (isRescheduleFlow && !activeMeeting.pendingSlotId)

    if (needsSelectBeforeConfirm) {
      if (!selectedSlotId) {
        setIsSubmitting(false)
        setMessage('נא לבחור מועד אחד.')
        return
      }
      const selectResult = await selectMeetingSlot(activeMeeting.id, selectedSlotId)
      if (!selectResult.ok) {
        setIsSubmitting(false)
        setMessage(mapMeetingCalendarError(selectResult.errorMessage))
        onChanged()
        return
      }
    }

    const confirmResult = await confirmMeeting(activeMeeting.id)
    setIsSubmitting(false)
    if (!confirmResult.ok) {
      setMessage(mapMeetingCalendarError(confirmResult.errorMessage))
      onChanged()
      return
    }

    onChanged()
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      title="פרטי פגישה"
      onClose={onClose}
      size="large"
    >
      <div className="mc-details">
        <dl className="mc-details-grid">
          <div>
            <dt>משתתף</dt>
            <dd>{getMeetingParticipantLabel(directory, otherParticipantId)}</dd>
          </div>
          <div>
            <dt>נושא</dt>
            <dd>{meeting.subject}</dd>
          </div>
          <div>
            <dt>סיבה</dt>
            <dd>{meeting.reason}</dd>
          </div>
          <div>
            <dt>סטטוס</dt>
            <dd>
              {translateMeetingState(meeting.currentState)}
              {meeting.reschedulingActive ? ' · בתהליך תיאום מחדש' : ''}
            </dd>
          </div>
          <div>
            <dt>משך</dt>
            <dd>{translateMeetingDuration(meeting.durationMinutes)}</dd>
          </div>
          <div>
            <dt>נוצר בתאריך</dt>
            <dd>{new Date(meeting.createdAt).toLocaleString('he-IL')}</dd>
          </div>
        </dl>

        {isLoadingSlots ? <p role="status">טוען מועדים…</p> : null}

        {confirmedSlot ? (
          <p className="mc-confirmed-slot">
            מועד מאושר נוכחי:{' '}
            {formatMeetingSlotRange(confirmedSlot, meeting.institutionTimezone)}
            {meeting.reschedulingActive
              ? ' (נשאר בתוקף עד אישור מועד חדש)'
              : ''}
          </p>
        ) : null}

        <MeetingHistoryList meetingId={meeting.id} directory={directory} />

        {selectedSlot &&
        (meeting.currentState === 'WAITING_FOR_FINAL_CONFIRMATION' ||
          (isRescheduleFlow && Boolean(meeting.pendingSlotId))) ? (
          <p className="mc-selected-slot">
            מועד נבחר: {formatMeetingSlotRange(selectedSlot, meeting.institutionTimezone)}
          </p>
        ) : null}

        {isCalendarOwner && meeting.currentState === 'WAITING_FOR_OWNER_APPROVAL' ? (
          <div className="mc-actions">
            <button
              type="button"
              className="ds-button"
              disabled={isSubmitting}
              onClick={() => void handleApprove()}
            >
              אישור בקשה והמשך להצעת מועדים
            </button>
          </div>
        ) : null}

        {canProposeSlots ? (
          <div className="mc-owner-propose">
            {isRescheduleFlow ? (
              <p className="mc-help-text">
                בחרו 1–5 מועדים חדשים. הפגישה המאושרת תישאר ביומן עד אישור מועד מחליף.
              </p>
            ) : null}

            {!isRescheduleFlow || !durationMinutes ? (
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
            ) : (
              <p className="mc-help-text">
                משך הפגישה: {translateMeetingDuration(durationMinutes)}
              </p>
            )}

            {durationMinutes ? (
              <MeetingProposeSlotsForm
                durationMinutes={durationMinutes}
                drafts={slotDrafts}
                onDraftsChange={setSlotDrafts}
                validationMessage={slotsValidationMessage}
              />
            ) : null}

            <div className="mc-actions">
              <button
                type="button"
                className="ds-button"
                disabled={isSubmitting || !durationMinutes}
                onClick={() => void handlePropose()}
              >
                שליחת מועדים
              </button>
            </div>
          </div>
        ) : null}

        {canSelectSlots ? (
          <div className="mc-select-slots">
            <fieldset>
              <legend>בחירת מועד</legend>
              <div role="radiogroup" aria-label="מועדים מוצעים">
                {proposedSlots.map((slot) => {
                  const inputId = `slot-${slot.id}`
                  return (
                    <label key={slot.id} className="mc-recipient-option" htmlFor={inputId}>
                      <input
                        id={inputId}
                        type="radio"
                        name="meeting-slot"
                        checked={selectedSlotId === slot.id}
                        onChange={() => setSelectedSlotId(slot.id)}
                      />
                      <span>{formatMeetingSlotRange(slot, meeting.institutionTimezone)}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            {selectedSlot ? (
              <p className="mc-selected-slot">
                סיכום: {formatMeetingSlotRange(selectedSlot, meeting.institutionTimezone)}
              </p>
            ) : null}

            <div className="mc-actions">
              <button
                type="button"
                className="ds-button ds-button--secondary"
                disabled={isSubmitting || !selectedSlotId}
                onClick={() => void handleSelectOnly()}
              >
                שמירת בחירה
              </button>
              <button
                type="button"
                className="ds-button"
                disabled={isSubmitting || !selectedSlotId}
                onClick={() => void handleFinalConfirm()}
                aria-label="אישור פגישה"
              >
                אישור פגישה
              </button>
            </div>
          </div>
        ) : null}

        {canFinalConfirm && !canSelectSlots ? (
          <div className="mc-actions">
            <button
              type="button"
              className="ds-button"
              disabled={isSubmitting}
              onClick={() => void handleFinalConfirm()}
              aria-label="אישור פגישה"
            >
              אישור פגישה
            </button>
          </div>
        ) : null}

        {meeting.currentState === 'CONFIRMED' && !meeting.reschedulingActive ? (
          <p className="ds-form-message ds-form-message--success">הפגישה אושרה.</p>
        ) : null}

        {message ? (
          <p className="ds-form-message ds-form-message--error" role="alert">
            {message}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
