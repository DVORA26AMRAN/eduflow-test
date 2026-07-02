import type { FormEvent } from 'react'
import './LoginPage.css'

type LoginPageProps = {
  email: string
  password: string
  message: string
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
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
  message,
  onEmailChange,
  onPasswordChange,
  onLogin,
}: LoginPageProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onLogin()
  }

  return (
    <main dir="rtl" className="login-page">
      <div className="ds-card ds-card--accent login-page__card">
        <header className="login-page__header">
          <h1 className="login-page__brand">EduFlow</h1>
          <p className="ds-card__subtitle login-page__welcome">
            ברוכה הבאה ל־EduFlow. התחברי כדי להמשיך.
          </p>
        </header>

        <h2 className="login-page__form-title">כניסה למערכת</h2>

        <form onSubmit={handleSubmit}>
          <label className="ds-field" htmlFor="login-email">
            <span className="ds-label">כתובת מייל</span>
            <input
              id="login-email"
              className="ds-input"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
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
              autoComplete="current-password"
              placeholder="הזיני סיסמה"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
            />
          </label>

          <button type="submit" className="ds-btn ds-btn--primary login-page__submit">
            התחברות
          </button>

          {message && <p className={getMessageClassName(message)}>{message}</p>}
        </form>
      </div>
    </main>
  )
}
