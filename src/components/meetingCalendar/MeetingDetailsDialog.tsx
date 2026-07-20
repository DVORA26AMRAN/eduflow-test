import { useEffect, useId, useState } from 'react'
import type { Meeting, MeetingSlot } from '../../types/meetingCalendar'
import {
  cancelMeeting,
  loadMeetingSlots,
  rescheduleMeeting,
} from '../../services/meetingCalendar'
import {
  getMeetingParticipantLabel,
  mapMeetingCalendarError,
  translateMeetingDuration,
  translateMeetingState,
  type MeetingUserDirectoryEntry,
} from '../../utils/meetingCalendarDisplay'
import {
  formatEventDate,
  formatEventTimeRange,
} from '../../utils/meetingCalendarView'
import { MEETING_CANCEL_REASON_MAX_LENGTH } from '../../utils/meetingCalendarLifecycle'
import { ConfirmDialog, Modal } from '../ui/Modal'
import { MeetingHistoryList } from './MeetingHistoryList'
import './MeetingCalendar.css'

type MeetingDetailsDialogProps = {
  isOpen: boolean
  meeting: Meeting
  actorUserId: string
  directory: Map<string, MeetingUserDirectoryEntry>
  confirmedSlot?: MeetingSlot | null
  onClose: () => void
  onChanged: () => void
  onRescheduleStarted?: (meetingId: string) => void
}

export function MeetingDetailsDialog({
  isOpen,
  meeting,
  actorUserId,
  directory,
  confirmedSlot = null,
  onClose,
  onChanged,
  onRescheduleStarted,
}: MeetingDetailsDialogProps) {
  const cancelReasonId = useId()
  const [loadedSlot, setLoadedSlot] = useState<MeetingSlot | null>(null)
  const [isLoadingSlot, setIsLoadingSlot] = useState(confirmedSlot == null)
  const [errorMessage, setErrorMessage] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (confirmedSlot) {
      return
    }

    const meetingId = meeting.id
    const confirmedSlotId = meeting.confirmedSlotId
    let cancelled = false

    void loadMeetingSlots(meetingId).then((result) => {
      if (cancelled) {
        return
      }
      setIsLoadingSlot(false)
      if (!result.ok) {
        setErrorMessage(result.errorMessage)
        return
      }
      const next =
        result.slots.find((item) => item.id === confirmedSlotId) ??
        result.slots.find((item) => item.slotStatus === 'confirmed') ??
        null
      setLoadedSlot(next)
    })

    return () => {
      cancelled = true
    }
  }, [confirmedSlot, meeting.confirmedSlotId, meeting.id])

  const slot = confirmedSlot ?? loadedSlot
  const participantId =
    meeting.requesterId === actorUserId ? meeting.recipientId : meeting.requesterId
  const isCalendarOwner = meeting.calendarOwnerId === actorUserId
  const canCancel =
    isCalendarOwner &&
    meeting.currentState !== 'CANCELLED' &&
    meeting.currentState !== 'COMPLETED'
  const canReschedule =
    isCalendarOwner &&
    meeting.currentState === 'CONFIRMED' &&
    !meeting.reschedulingActive

  async function handleCancelConfirm() {
    if (cancelReason.trim().length > MEETING_CANCEL_REASON_MAX_LENGTH) {
      setErrorMessage(`סיבת הביטול מוגבלת ל-${MEETING_CANCEL_REASON_MAX_LENGTH} תווים.`)
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')
    const result = await cancelMeeting(meeting.id, cancelReason.trim() || undefined)
    setIsSubmitting(false)

    if (!result.ok) {
      setErrorMessage(mapMeetingCalendarError(result.errorMessage))
      return
    }

    setCancelOpen(false)
    setCancelReason('')
    onChanged()
    onClose()
  }

  async function handleRescheduleConfirm() {
    setIsSubmitting(true)
    setErrorMessage('')
    const result = await rescheduleMeeting(meeting.id)
    setIsSubmitting(false)
    setRescheduleOpen(false)

    if (!result.ok) {
      setErrorMessage(mapMeetingCalendarError(result.errorMessage))
      onChanged()
      return
    }

    onChanged()
    onClose()
    onRescheduleStarted?.(meeting.id)
  }

  return (
    <>
      <Modal isOpen={isOpen} title="פרטי פגישה" onClose={onClose} size="large">
        <div className="mc-details">
          {isLoadingSlot ? <p role="status">טוען פרטי פגישה…</p> : null}
          {errorMessage ? (
            <p className="ds-form-message ds-form-message--error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <dl className="mc-details-grid">
            <div>
              <dt>נושא</dt>
              <dd>{meeting.subject}</dd>
            </div>
            <div>
              <dt>סיבה</dt>
              <dd>{meeting.reason}</dd>
            </div>
            <div>
              <dt>משתתף</dt>
              <dd>{getMeetingParticipantLabel(directory, participantId)}</dd>
            </div>
            <div>
              <dt>משך</dt>
              <dd>{translateMeetingDuration(meeting.durationMinutes)}</dd>
            </div>
            <div>
              <dt>תאריך</dt>
              <dd>
                {slot
                  ? formatEventDate(slot.startsAt, meeting.institutionTimezone)
                  : 'טרם נקבע'}
              </dd>
            </div>
            <div>
              <dt>שעה</dt>
              <dd>
                {slot
                  ? formatEventTimeRange(
                      slot.startsAt,
                      slot.endsAt,
                      meeting.institutionTimezone,
                    )
                  : 'טרם נקבע'}
              </dd>
            </div>
            <div>
              <dt>סטטוס</dt>
              <dd>
                {translateMeetingState(meeting.currentState)}
                {meeting.reschedulingActive ? ' · בתהליך תיאום מחדש' : ''}
              </dd>
            </div>
          </dl>

          <MeetingHistoryList meetingId={meeting.id} directory={directory} />

          <div className="mc-actions">
            {canReschedule ? (
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={() => setRescheduleOpen(true)}
                disabled={isSubmitting}
              >
                תיאום מחדש
              </button>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                className="ds-btn ds-btn--danger"
                onClick={() => {
                  setErrorMessage('')
                  setCancelOpen(true)
                }}
                disabled={isSubmitting}
              >
                ביטול פגישה
              </button>
            ) : null}
            <button type="button" className="ds-btn ds-btn--secondary" onClick={onClose}>
              סגירה
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={cancelOpen}
        title="ביטול פגישה"
        onClose={() => {
          if (!isSubmitting) {
            setCancelOpen(false)
          }
        }}
        size="small"
      >
        <div className="mc-cancel-form">
          <p>האם לבטל את הפגישה? הפגישה תוסר מהיומן ותישמר בהיסטוריה.</p>
          <label className="ds-field" htmlFor={cancelReasonId}>
            <span>סיבת ביטול (אופציונלי)</span>
            <textarea
              id={cancelReasonId}
              value={cancelReason}
              maxLength={MEETING_CANCEL_REASON_MAX_LENGTH}
              rows={3}
              onChange={(event) => setCancelReason(event.target.value)}
              disabled={isSubmitting}
            />
          </label>
          <p className="mc-help-text" aria-live="polite">
            {cancelReason.length}/{MEETING_CANCEL_REASON_MAX_LENGTH}
          </p>
          <div className="mc-actions">
            <button
              type="button"
              className="ds-btn ds-btn--secondary"
              onClick={() => setCancelOpen(false)}
              disabled={isSubmitting}
            >
              המשך בלי לבטל
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--danger"
              onClick={() => void handleCancelConfirm()}
              disabled={isSubmitting}
            >
              אישור ביטול
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={rescheduleOpen}
        title="תיאום מחדש"
        message="הפגישה המאושרת תישאר פעילה עד שיאושר מועד חדש. האם להתחיל תיאום מחדש?"
        confirmLabel="התחלת תיאום מחדש"
        continueLabel="ביטול"
        confirmDisabled={isSubmitting}
        continueDisabled={isSubmitting}
        onConfirm={() => void handleRescheduleConfirm()}
        onContinue={() => setRescheduleOpen(false)}
      />
    </>
  )
}
