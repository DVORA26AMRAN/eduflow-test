import type { FormEvent } from 'react'
import './LoginPage.css'
import organizationLogo from '../assets/images/logo.png.png'

type LoginPageProps = {
  email: string
  password: string
  rememberMe: boolean
  message: string
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onRememberMeChange: (value: boolean) => void
  onLogin: () => void
}

function getMessageClassName(message: string): string {
  if (!message) {
    return 'ds-form-message login-page__message'
  }

  if (message.includes('נכשל')) {
    return 'ds-form-message ds-form-message--error login-page__message'
  }

  if (message.includes('בהצלחה')) {
    return 'ds-form-message ds-form-message--success login-page__message'
  }

  return 'ds-form-message login-page__message'
}

export function LoginPage({
  email,
  password,
  rememberMe,
  message,
  onEmailChange,
  onPasswordChange,
  onRememberMeChange,
  onLogin,
}: LoginPageProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onLogin()
  }

  return (
    <main dir="rtl" className="login-page">
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
              ברוכים הבאים. התחברו כדי להמשיך.
            </p>
          </header>

          <h2 className="login-page__form-title">כניסה למערכת</h2>

          <form onSubmit={handleSubmit} className="login-page__form">
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

            {message && <p className={getMessageClassName(message)}>{message}</p>}
          </form>
        </div>

      </section>
    </main>
  )
}
