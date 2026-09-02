import { useState, type FormEvent } from 'react'
import './LoginPage.css'
import organizationLogo from '../assets/images/logo.png.png'
import { InstallMpexButton } from '../pwa/InstallMpexButton'
import { isStandaloneDisplayMode } from '../pwa/displayMode'
import { PASSWORD_RECOVERY_CONFIRMATION_MESSAGE } from '../services/passwordRecovery'

type LoginPageProps = {
  email: string
  password: string
  rememberMe: boolean
  message: string
  isRequestingPasswordReset?: boolean
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onRememberMeChange: (value: boolean) => void
  onLogin: () => void
  onRequestPasswordReset: () => void
}

const INSTALLED_APP_WARNING_TITLE = 'שימוש במחשב משותף'
const INSTALLED_APP_WARNING_BODY =
  "אם מחשב זה משמש כמה אנשי צוות, אין לשמור את סיסמת MPEX בדפדפן.\n\nשמירת הסיסמה עלולה לאפשר למשתמשת אחרת במחשב להיכנס לחשבונך.\n\nאם הדפדפן מציע לשמור את הסיסמה, יש לבחור 'אף פעם' או 'לא עכשיו'."
const INSTALLED_APP_WARNING_ACK = 'הבנתי'

function getMessageClassName(message: string): string {
  if (!message) {
    return 'ds-form-message login-page__message'
  }

  if (message === PASSWORD_RECOVERY_CONFIRMATION_MESSAGE || message.includes('בהצלחה')) {
    return 'ds-form-message ds-form-message--success login-page__message'
  }

  if (message.includes('נכשל') || message.includes('נא להזין')) {
    return 'ds-form-message ds-form-message--error login-page__message'
  }

  return 'ds-form-message login-page__message'
}

export function LoginPage({
  email,
  password,
  rememberMe,
  message,
  isRequestingPasswordReset = false,
  onEmailChange,
  onPasswordChange,
  onRememberMeChange,
  onLogin,
  onRequestPasswordReset,
}: LoginPageProps) {
  const [isInstalledWarningDismissed, setIsInstalledWarningDismissed] = useState(false)
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const showInstalledWarning =
    isStandaloneDisplayMode() && !isInstalledWarningDismissed

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onLogin()
  }

  function handleForgotSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onRequestPasswordReset()
  }

  function openForgotMode() {
    setMode('forgot')
  }

  function backToLogin() {
    setMode('login')
  }

  return (
    <main dir="rtl" className="login-page">
      <InstallMpexButton variant="login" />

      {showInstalledWarning ? (
        <section
          className="login-page__security-warning"
          aria-labelledby="installed-app-security-warning-title"
          data-testid="installed-app-security-warning"
        >
          <div className="login-page__security-warning-panel" role="dialog" aria-modal="true">
            <h2
              id="installed-app-security-warning-title"
              className="login-page__security-warning-title"
            >
              {INSTALLED_APP_WARNING_TITLE}
            </h2>
            <p className="login-page__security-warning-body">
              {INSTALLED_APP_WARNING_BODY}
            </p>
            <button
              type="button"
              className="ds-btn ds-btn--primary login-page__security-warning-action"
              onClick={() => setIsInstalledWarningDismissed(true)}
            >
              {INSTALLED_APP_WARNING_ACK}
            </button>
          </div>
        </section>
      ) : null}

      <section className="login-page__shell" aria-label="מסך התחברות">
        {/* Login card first: desktop RTL = RIGHT; mobile stack = form first */}
        <div className="ds-card ds-card--flat login-page__card">
          <header className="login-page__header">
            <h1 className="login-page__brand">
              <img
                className="login-page__brand-logo"
                src={organizationLogo}
                alt="לוגו הארגון"
              />
            </h1>
            <p className="ds-card__subtitle login-page__welcome">
              {mode === 'forgot'
                ? 'נא להזין את כתובת האימייל לחשבון שלך.'
                : 'ברוכים הבאים. התחברו כדי להמשיך.'}
            </p>
          </header>

          <h2 className="login-page__form-title">
            {mode === 'forgot' ? 'שחזור סיסמה' : 'כניסה למערכת'}
          </h2>

          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="login-page__form">
              <label className="ds-field" htmlFor="login-email">
                <span className="ds-label">שם משתמש</span>
                <input
                  id="login-email"
                  className="ds-input"
                  type="email"
                  name="username"
                  autoComplete="username"
                  placeholder="הזן שם משתמש"
                  value={email}
                  onChange={(e) => onEmailChange(e.target.value)}
                />
              </label>

              <label className="ds-field" htmlFor="login-password">
                <span className="ds-label">סיסמה</span>
                <input
                  id="login-password"
                  className="ds-input"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="הזן סיסמה"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                />
              </label>

              <label className="login-page__remember-me" htmlFor="login-remember-me">
                <span className="login-page__remember-checkbox">
                  <input
                    id="login-remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => onRememberMeChange(e.target.checked)}
                  />
                  <span>זכור את כתובת המייל</span>
                </span>
              </label>

              <button type="submit" className="ds-btn ds-btn--primary login-page__submit">
                התחברות
              </button>

              <button
                type="button"
                className="login-page__forgot-link"
                onClick={openForgotMode}
                data-testid="forgot-password-link"
              >
                שכחת סיסמה?
              </button>

              {message && <p className={getMessageClassName(message)}>{message}</p>}
            </form>
          ) : (
            <form
              onSubmit={handleForgotSubmit}
              className="login-page__form"
              data-testid="forgot-password-form"
            >
              <label className="ds-field" htmlFor="forgot-email">
                <span className="ds-label">אימייל</span>
                <input
                  id="forgot-email"
                  className="ds-input"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="הזן כתובת אימייל"
                  value={email}
                  onChange={(e) => onEmailChange(e.target.value)}
                />
              </label>

              <button
                type="submit"
                className="ds-btn ds-btn--primary login-page__submit"
                disabled={isRequestingPasswordReset}
              >
                {isRequestingPasswordReset ? 'שולחת...' : 'שליחת קישור'}
              </button>

              <button
                type="button"
                className="login-page__forgot-link"
                onClick={backToLogin}
                data-testid="forgot-password-back"
              >
                חזרה להתחברות
              </button>

              {message && <p className={getMessageClassName(message)}>{message}</p>}
            </form>
          )}
        </div>
      </section>
    </main>
  )
}
