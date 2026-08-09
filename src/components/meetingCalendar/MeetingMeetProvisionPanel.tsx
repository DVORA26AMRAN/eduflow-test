import { useEffect, useState } from 'react'
import {
  getGoogleConnectionStatus,
  startGoogleOAuth,
  type GoogleConnectionStatus,
} from '../../services/googleOAuth'
import { requestMeetProvision } from '../../services/meetingGoogleMeet'
import type { MeetingLiveContext } from '../../services/meetingCalendar'
import {
  GOOGLE_MEET_CONNECT_REQUIRED_MESSAGE,
  mapMeetProvisionUserError,
  mergeOwnerGoogleConnectionForMeetUi,
  resolveMeetProvisionUi,
  type OwnerGoogleConnectionStatus,
} from '../../utils/meetingMeetProvisionUi'

type MeetingMeetProvisionPanelProps = {
  meetingId: string
  context: MeetingLiveContext
  primaryActionAvailable: boolean
  isOpeningMeet: boolean
  onStartMeeting: () => void
  onContextChanged: () => void
}

function toOwnerConnectionStatus(
  status: GoogleConnectionStatus,
): OwnerGoogleConnectionStatus {
  if (status === 'connected' || status === 'reauthorization_required') {
    return status
  }
  return 'not_connected'
}

export function MeetingMeetProvisionPanel({
  meetingId,
  context,
  primaryActionAvailable,
  isOpeningMeet,
  onStartMeeting,
  onContextChanged,
}: MeetingMeetProvisionPanelProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRequesting, setIsRequesting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [freshConnected, setFreshConnected] = useState<boolean | null>(null)
  const [freshConnectionStatus, setFreshConnectionStatus] =
    useState<OwnerGoogleConnectionStatus | null>(null)

  // Once liveContext catches up to disconnected/reauth, ignore local soft-validate override.
  const discardFreshOverride =
    context.ownerGoogleConnectionStatus === 'reauthorization_required' ||
    context.ownerGoogleConnectionStatus === 'not_connected' ||
    !context.ownerGoogleConnected

  if (
    discardFreshOverride &&
    (freshConnected !== null || freshConnectionStatus !== null)
  ) {
    setFreshConnected(null)
    setFreshConnectionStatus(null)
  }

  const mergedConnection = mergeOwnerGoogleConnectionForMeetUi({
    ownerGoogleConnected: context.ownerGoogleConnected,
    ownerGoogleConnectionStatus: context.ownerGoogleConnectionStatus,
    freshConnected: discardFreshOverride ? null : freshConnected,
    freshConnectionStatus: discardFreshOverride ? null : freshConnectionStatus,
  })

  const ui = resolveMeetProvisionUi({
    meetingFormat: context.meetingFormat,
    meetUrl: context.meetUrl,
    meetProvisionStatus: context.meetProvisionStatus,
    meetProvisionError: context.meetProvisionError,
    ownerGoogleConnected: mergedConnection.ownerGoogleConnected,
    ownerGoogleConnectionStatus: mergedConnection.ownerGoogleConnectionStatus,
    canRequestMeetProvision: context.canRequestMeetProvision,
    isCalendarOwner: context.isCalendarOwner,
    primaryActionAvailable,
  })

  // Soft-validate when liveContext still claims Google is connected. Never starts OAuth
  // or Meet provisioning — only corrects a stale Create Meet CTA.
  useEffect(() => {
    if (!context.isCalendarOwner) {
      return
    }
    if (
      !context.ownerGoogleConnected &&
      context.ownerGoogleConnectionStatus !== 'connected'
    ) {
      return
    }

    let cancelled = false
    void getGoogleConnectionStatus().then((result) => {
      if (cancelled || !result.ok) {
        return
      }
      const status = toOwnerConnectionStatus(result.connectionStatus)
      if (status === 'connected' && result.connected) {
        setFreshConnected(true)
        setFreshConnectionStatus('connected')
        return
      }
      setFreshConnected(false)
      setFreshConnectionStatus(status)
    })

    return () => {
      cancelled = true
    }
  }, [
    meetingId,
    context.isCalendarOwner,
    context.ownerGoogleConnected,
    context.ownerGoogleConnectionStatus,
  ])

  useEffect(() => {
    if (ui.kind !== 'creating') {
      return
    }

    const timer = window.setInterval(() => {
      onContextChanged()
    }, 4_000)

    return () => window.clearInterval(timer)
  }, [ui.kind, onContextChanged])

  if (ui.kind === 'hidden') {
    return null
  }

  async function handleConnectGoogle() {
    setIsConnecting(true)
    setErrorMessage('')
    const result = await startGoogleOAuth()
    if (!result.ok) {
      setIsConnecting(false)
      setErrorMessage(
        result.errorMessage === 'forbidden'
          ? 'אין הרשאה לחבר חשבון Google.'
          : 'לא ניתן להתחיל חיבור Google.',
      )
      return
    }
    window.location.assign(result.authorizationUrl)
  }

  async function handleRequestMeet(kind: 'create' | 'retry') {
    setIsRequesting(true)
    setErrorMessage('')
    void kind
    const result = await requestMeetProvision(meetingId)
    setIsRequesting(false)

    if (!result.ok) {
      setErrorMessage(mapMeetProvisionUserError(result.errorMessage))
      return
    }

    if (result.code === 'GOOGLE_NOT_CONNECTED') {
      setErrorMessage(GOOGLE_MEET_CONNECT_REQUIRED_MESSAGE)
      setFreshConnected(false)
      setFreshConnectionStatus('reauthorization_required')
      // Soft-refresh parent context without requiring the panel to unmount first.
      onContextChanged()
      return
    }

    onContextChanged()
  }

  return (
    <section
      className={`mc-meet-provision mc-meet-provision--${ui.kind}`}
      aria-label="מצב Google Meet"
    >
      <p
        className="mc-meet-provision__status"
        role="status"
        aria-live="polite"
        data-testid="meet-provision-status"
      >
        {ui.statusLabel}
      </p>
      {ui.helpText ? <p className="mc-help-text">{ui.helpText}</p> : null}

      {errorMessage ? (
        <p className="ds-form-message ds-form-message--error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="mc-actions mc-meet-provision__actions">
        {ui.showConnectGoogle ? (
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            onClick={() => void handleConnectGoogle()}
            disabled={isConnecting}
            aria-busy={isConnecting}
          >
            {isConnecting ? 'מעבירים…' : 'חבר חשבון Google'}
          </button>
        ) : null}

        {ui.showCreateMeet ? (
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            onClick={() => void handleRequestMeet('create')}
            disabled={isRequesting}
            aria-busy={isRequesting}
          >
            {isRequesting ? 'יוצרים…' : 'צור Google Meet'}
          </button>
        ) : null}

        {ui.showRetry ? (
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={() => void handleRequestMeet('retry')}
            disabled={isRequesting}
            aria-busy={isRequesting}
          >
            {isRequesting ? 'שולחים…' : 'נסה שוב'}
          </button>
        ) : null}

        {ui.showStartMeeting ? (
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            onClick={onStartMeeting}
            disabled={isOpeningMeet}
            aria-busy={isOpeningMeet}
          >
            {isOpeningMeet ? 'פותח…' : 'התחל פגישה'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
