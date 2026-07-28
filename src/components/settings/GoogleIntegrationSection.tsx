import { useCallback, useEffect, useState } from 'react'
import { DashboardSection } from '../dashboard/DashboardSection'
import { NavSettingsIcon } from '../dashboard/dashboardNav'
import {
  clearGoogleIntegrationReturnFromUrl,
  detectGoogleIntegrationReturn,
  disconnectGoogleOAuth,
  getGoogleConnectionStatus,
  startGoogleOAuth,
  type GoogleConnectionStatus,
} from '../../services/googleOAuth'

type UiPhase =
  | 'loading'
  | 'not_connected'
  | 'connected'
  | 'reauthorization_required'
  | 'connecting'
  | 'failed'

type GoogleIntegrationSectionProps = {
  initialReturnMessage?: string | null
}

function statusToPhase(status: GoogleConnectionStatus): Exclude<UiPhase, 'loading' | 'connecting' | 'failed'> {
  if (status === 'connected') return 'connected'
  if (status === 'reauthorization_required') return 'reauthorization_required'
  return 'not_connected'
}

function mapReturnError(code: string | null): string {
  switch (code) {
    case 'provider_error':
      return 'חיבור Google בוטל או נדחה.'
    case 'state_reused':
    case 'state_expired':
    case 'state_invalid':
    case 'state_rejected':
      return 'בקשת החיבור אינה תקפה. נסו שוב.'
    case 'redirect_uri_mismatch':
      return 'כתובת החזרה אינה תואמת את הגדרות Google.'
    case 'token_exchange_failed':
    case 'upsert_failed':
      return 'חיבור Google נכשל. לא נשמרו פרטי התחברות.'
    default:
      return 'חיבור Google נכשל. נסו שוב.'
  }
}

export function GoogleIntegrationSection({
  initialReturnMessage = null,
}: GoogleIntegrationSectionProps) {
  const [phase, setPhase] = useState<UiPhase>('loading')
  const [email, setEmail] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(initialReturnMessage)
  const [messageTone, setMessageTone] = useState<'success' | 'error' | 'info'>('info')

  const refreshStatus = useCallback(async () => {
    const result = await getGoogleConnectionStatus()
    if (!result.ok) {
      setPhase('failed')
      setMessage('לא ניתן לטעון את מצב חיבור Google.')
      setMessageTone('error')
      return
    }
    setEmail(result.email)
    setPhase(statusToPhase(result.connectionStatus))
  }, [])

  useEffect(() => {
    const ret = detectGoogleIntegrationReturn()
    queueMicrotask(() => {
      if (ret) {
        clearGoogleIntegrationReturnFromUrl()
        if (ret.kind === 'connected') {
          setMessage('חשבון Google חובר בהצלחה.')
          setMessageTone('success')
        } else if (ret.kind === 'error') {
          setMessage(mapReturnError(ret.code))
          setMessageTone('error')
          setPhase('failed')
        }
      }
      void refreshStatus()
    })
  }, [refreshStatus])

  async function handleConnect() {
    setPhase('connecting')
    setMessage('מעבירים לאישור Google...')
    setMessageTone('info')
    const result = await startGoogleOAuth()
    if (!result.ok) {
      setPhase('failed')
      setMessage(
        result.errorMessage === 'forbidden'
          ? 'אין הרשאה לחבר חשבון Google.'
          : 'לא ניתן להתחיל חיבור Google.',
      )
      setMessageTone('error')
      return
    }
    window.location.assign(result.authorizationUrl)
  }

  async function handleDisconnect() {
    setPhase('connecting')
    setMessage('מנתקים את חשבון Google...')
    setMessageTone('info')
    const result = await disconnectGoogleOAuth()
    if (!result.ok) {
      setPhase('failed')
      setMessage('ניתוק Google נכשל.')
      setMessageTone('error')
      await refreshStatus()
      return
    }
    setEmail(null)
    setPhase('not_connected')
    setMessage('חשבון Google נותק.')
    setMessageTone('success')
  }

  return (
    <section className="ds-card user-settings__google">
      <DashboardSection
        title="אינטגרציית Google"
        icon={<NavSettingsIcon />}
        className="dashboard-section--flush-header"
      >
        <p className="ds-helper-text">
          חיבור חשבון Google האישי מאפשר יצירת קישורי Google Meet לפגישות מקוונות.
          לא מתבצע סנכרון יומן.
        </p>

        {message && (
          <p
            className={
              messageTone === 'error'
                ? 'ds-form-message ds-form-message--error'
                : messageTone === 'success'
                  ? 'ds-form-message ds-form-message--success'
                  : 'ds-form-message'
            }
            role="status"
          >
            {message}
          </p>
        )}

        {phase === 'loading' && <p className="ds-form-message">טוען מצב חיבור...</p>}

        {phase === 'connecting' && (
          <p className="ds-form-message">החיבור בתהליך...</p>
        )}

        {phase === 'not_connected' && (
          <div className="user-settings__google-actions">
            <p className="ds-helper-text">חשבון Google אינו מחובר.</p>
            <button type="button" className="ds-btn ds-btn--primary" onClick={() => void handleConnect()}>
              חבר חשבון Google
            </button>
          </div>
        )}

        {phase === 'connected' && (
          <div className="user-settings__google-actions">
            <p className="ds-helper-text">
              מחובר כ־<strong>{email ?? 'חשבון Google'}</strong>
            </p>
            <button
              type="button"
              className="ds-btn ds-btn--secondary"
              onClick={() => void handleDisconnect()}
            >
              נתק חשבון Google
            </button>
          </div>
        )}

        {phase === 'reauthorization_required' && (
          <div className="user-settings__google-actions">
            <p className="ds-form-message ds-form-message--error">
              נדרש אישור מחדש לחשבון Google
              {email ? ` (${email})` : ''}.
            </p>
            <button type="button" className="ds-btn ds-btn--primary" onClick={() => void handleConnect()}>
              אשר מחדש חשבון Google
            </button>
          </div>
        )}

        {phase === 'failed' && (
          <div className="user-settings__google-actions">
            <button type="button" className="ds-btn ds-btn--primary" onClick={() => void handleConnect()}>
              נסה שוב
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--secondary"
              onClick={() => void refreshStatus()}
            >
              רענן מצב
            </button>
          </div>
        )}
      </DashboardSection>
    </section>
  )
}
