import { useEffect, useRef, useState } from 'react'
import type { MeetingLiveContext } from '../../services/meetingCalendar'
import {
  recordLivePrimaryAction,
  reportMeetingDelay,
  setMeetingConnectionDetails,
} from '../../services/meetingCalendar'
import { mapMeetingCalendarError } from '../../utils/meetingCalendarDisplay'
import {
  MEETING_DELAY_OPTIONS_MINUTES,
  buildTelHref,
  getMeetingLiveStatus,
  isDelayActionAvailable,
  isPrimaryLiveActionAvailable,
  isSafeGoogleMeetJoinUrl,
  translateMeetingFormat,
  type MeetingDelayMinutes,
  type MeetingFormat,
} from '../../utils/meetingCalendarLive'
import { Modal } from '../ui/Modal'
import { MeetingFormatFields } from './MeetingFormatFields'
import { MeetingMeetProvisionPanel } from './MeetingMeetProvisionPanel'

type MeetingLiveActionsProps = {
  meetingId: string
  context: MeetingLiveContext | null
  isLoading: boolean
  onContextChanged: () => void
}

export function MeetingLiveActions({
  meetingId,
  context,
  isLoading,
  onContextChanged,
}: MeetingLiveActionsProps) {
  const [now, setNow] = useState(() => new Date())
  const [delayOpen, setDelayOpen] = useState(false)
  const [selectedDelay, setSelectedDelay] = useState<MeetingDelayMinutes>(5)
  const [isOpening, setIsOpening] = useState(false)
  const [isReporting, setIsReporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openLockRef = useRef(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  if (isLoading) {
    return <p role="status">טוען פעולות פגישה…</p>
  }

  if (!context || context.currentState !== 'CONFIRMED') {
    return null
  }

  const liveStatus = getMeetingLiveStatus(context.startsAt, context.endsAt, now)
  const primaryAvailable =
    context.primaryActionAvailable ||
    isPrimaryLiveActionAvailable(context.startsAt, context.endsAt, now)
  const delayAvailable =
    context.delayActionAvailable || isDelayActionAvailable(context.startsAt, context.endsAt, now)

  async function handlePrimaryAction() {
    if (!context || openLockRef.current || !primaryAvailable) {
      return
    }

    setErrorMessage('')
    openLockRef.current = true
    setIsOpening(true)

    try {
      const result = await recordLivePrimaryAction(meetingId)
      if (!result.ok) {
        setErrorMessage(mapMeetingCalendarError(result.errorMessage))
        return
      }

      if (result.eventType === 'online_meeting_opened') {
        if (!result.meetUrl || !isSafeGoogleMeetJoinUrl(result.meetUrl)) {
          setErrorMessage('קישור הפגישה המקוונת אינו זמין.')
          return
        }
        window.open(result.meetUrl, '_blank', 'noopener,noreferrer')
      } else if (result.eventType === 'phone_call_started') {
        if (!result.phoneNumber) {
          setErrorMessage('מספר הטלפון אינו זמין.')
          return
        }
        window.location.href = buildTelHref(result.phoneNumber)
      }
    } finally {
      window.setTimeout(() => {
        openLockRef.current = false
        setIsOpening(false)
      }, 800)
    }
  }

  async function handleDelayConfirm() {
    setIsReporting(true)
    setErrorMessage('')
    const result = await reportMeetingDelay({
      meetingId,
      delayMinutes: selectedDelay,
    })
    setIsReporting(false)

    if (!result.ok) {
      setErrorMessage(mapMeetingCalendarError(result.errorMessage))
      return
    }

    setDelayOpen(false)
    onContextChanged()
  }

  return (
    <section className="mc-live-actions" aria-label="פעולות פגישה חיה">
      {liveStatus.label ? (
        <p className={`mc-live-status mc-live-status--${liveStatus.kind}`} role="status">
          {liveStatus.label}
        </p>
      ) : null}

      <p className="mc-help-text">סוג פגישה: {translateMeetingFormat(context.meetingFormat)}</p>

      {context.meetingFormat === 'online' ? (
        <MeetingMeetProvisionPanel
          meetingId={meetingId}
          context={context}
          primaryActionAvailable={primaryAvailable}
          isOpeningMeet={isOpening}
          onStartMeeting={() => void handlePrimaryAction()}
          onContextChanged={onContextChanged}
        />
      ) : null}

      {context.delayMinutes ? (
        <p className="mc-help-text" role="status">
          דיווח איחור נוכחי: {context.delayMinutes} דקות
        </p>
      ) : null}

      {errorMessage ? (
        <p className="ds-form-message ds-form-message--error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="mc-actions">
        {context.meetingFormat === 'phone' && primaryAvailable ? (
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            onClick={() => void handlePrimaryAction()}
            disabled={isOpening}
            aria-busy={isOpening}
          >
            {isOpening ? 'פותח…' : 'התקשר'}
          </button>
        ) : null}

        {delayAvailable ? (
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={() => {
              setErrorMessage('')
              setDelayOpen(true)
            }}
            disabled={isReporting}
          >
            אני מאחר
          </button>
        ) : null}

        {context.canSetConnectionDetails ? (
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={() => setSettingsOpen(true)}
          >
            הגדרת סוג פגישה
          </button>
        ) : null}
      </div>

      <Modal
        isOpen={delayOpen}
        title="דיווח איחור"
        onClose={() => {
          if (!isReporting) {
            setDelayOpen(false)
          }
        }}
        size="small"
      >
        <div className="mc-delay-form">
          <p className="mc-help-text">בחרו את משך האיחור. הדיווח יוחלף אם יישלח שוב.</p>
          <div
            className="mc-calendar-board__modes"
            role="radiogroup"
            aria-label="משך איחור בדקות"
          >
            {MEETING_DELAY_OPTIONS_MINUTES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selectedDelay === option}
                className={`ds-btn ${
                  selectedDelay === option ? 'ds-btn--primary' : 'ds-btn--secondary'
                }`}
                onClick={() => setSelectedDelay(option)}
                disabled={isReporting}
              >
                {option} דקות
              </button>
            ))}
          </div>
          <div className="mc-actions">
            <button
              type="button"
              className="ds-btn ds-btn--secondary"
              onClick={() => setDelayOpen(false)}
              disabled={isReporting}
            >
              ביטול
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--primary"
              onClick={() => void handleDelayConfirm()}
              disabled={isReporting}
            >
              {isReporting ? 'שולח…' : 'אישור דיווח'}
            </button>
          </div>
        </div>
      </Modal>

      {settingsOpen ? (
        <MeetingConnectionSettingsModal
          key={`${meetingId}-${context.meetingFormat}-${context.phoneNumber ?? ''}`}
          isOpen={settingsOpen}
          meetingId={meetingId}
          initialFormat={context.meetingFormat}
          initialPhoneNumber={context.phoneNumber}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false)
            onContextChanged()
          }}
        />
      ) : null}
    </section>
  )
}

type MeetingConnectionSettingsModalProps = {
  isOpen: boolean
  meetingId: string
  initialFormat: MeetingFormat
  initialPhoneNumber: string | null
  onClose: () => void
  onSaved: () => void
}

function MeetingConnectionSettingsModal({
  isOpen,
  meetingId,
  initialFormat,
  initialPhoneNumber,
  onClose,
  onSaved,
}: MeetingConnectionSettingsModalProps) {
  const [format, setFormat] = useState<MeetingFormat>(initialFormat)
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSave() {
    setIsSaving(true)
    setErrorMessage('')
    const result = await setMeetingConnectionDetails({
      meetingId,
      meetingFormat: format,
      phoneNumber: format === 'phone' ? phoneNumber : null,
    })
    setIsSaving(false)

    if (!result.ok) {
      setErrorMessage(mapMeetingCalendarError(result.errorMessage))
      return
    }

    onSaved()
  }

  return (
    <Modal isOpen={isOpen} title="הגדרת סוג פגישה" onClose={onClose} size="medium">
      <div className="mc-connection-form">
        <MeetingFormatFields
          format={format}
          phoneNumber={phoneNumber}
          disabled={isSaving}
          onFormatChange={setFormat}
          onPhoneNumberChange={setPhoneNumber}
        />

        {errorMessage ? (
          <p className="ds-form-message ds-form-message--error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="mc-actions">
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={onClose}
            disabled={isSaving}
          >
            ביטול
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            onClick={() => void handleSave()}
            disabled={isSaving || (format === 'phone' && !phoneNumber.trim())}
          >
            {isSaving ? 'שומר…' : 'שמירה'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
