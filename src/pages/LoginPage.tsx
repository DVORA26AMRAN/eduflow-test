import type { FormEvent } from 'react'
import './LoginPage.css'
import organizationLogo from '../assets/images/logo.png.png'
import schoolBuildingImage from '../assets/images/school-building.png.png'

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

        {/* Visual panel second: desktop RTL = LEFT */}
        <aside className="login-page__visual" aria-hidden="true">
          <div className="login-page__visual-hero">
            <img
              className="login-page__visual-hero-image"
              src={schoolBuildingImage}
              alt=""
            />
          </div>
          <div className="login-page__roles">
            <article className="login-page__role-card login-page__role-card--manager">
              <div className="login-page__role-icon-wrap" aria-hidden="true">
                {/* Brand management icon: school / institution building */}
                <svg className="login-page__role-glyph" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="18.5" stroke="currentColor" strokeWidth="1.8" />
                  <path
                    d="M16 32.5V20.2l8-4.7 8 4.7V32.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path d="M20.2 32.5V25.4h7.6v7.1" stroke="currentColor" strokeWidth="1.8" />
                  <circle cx="24" cy="21.4" r="2.1" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="M24 12.8v-2.6M24 10.2l3.2-1.4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h3 className="login-page__role-title">מנהלת</h3>
              <p className="login-page__role-text">
                ניהול כולל של המערכת, תקציבים ודוחות.
              </p>
            </article>

            <article className="login-page__role-card login-page__role-card--secretary">
              <div className="login-page__role-icon-wrap" aria-hidden="true">
                {/* Brand secretary icon: monitor with document */}
                <svg className="login-page__role-glyph" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="18.5" stroke="currentColor" strokeWidth="1.8" />
                  <rect
                    x="14.5"
                    y="15"
                    width="19"
                    height="13.5"
                    rx="1.6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path d="M19 33.8h10M24 28.5v5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path
                    d="M18.8 19.2h10.4M18.8 22.2h10.4M18.8 25.2h7.2"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h3 className="login-page__role-title">מזכירות</h3>
              <p className="login-page__role-text">
                ניהול פניות, מסמכים, יומן ומשימות.
              </p>
            </article>

            <article className="login-page__role-card login-page__role-card--teacher">
              <div className="login-page__role-icon-wrap" aria-hidden="true">
                {/* Brand teacher icon: open book in front of monitor */}
                <svg className="login-page__role-glyph" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="18.5" stroke="currentColor" strokeWidth="1.8" />
                  <rect
                    x="16.5"
                    y="14.5"
                    width="15"
                    height="11"
                    rx="1.4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <path d="M21 29.3h6M24 25.5v3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  <path
                    d="M14.8 32.5c2.8-2.4 5.7-3.6 9.2-3.6s6.4 1.2 9.2 3.6"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                  <path
                    d="M17.5 31.2c1.9-1.1 4-1.7 6.5-1.7s4.6.6 6.5 1.7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h3 className="login-page__role-title">מורים</h3>
              <p className="login-page__role-text">
                ניהול כיתה, בקשות ותכנון שיעורים.
              </p>
            </article>
          </div>
        </aside>
      </section>
    </main>
  )
}
