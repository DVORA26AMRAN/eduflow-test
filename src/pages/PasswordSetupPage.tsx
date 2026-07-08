type PasswordSetupPageProps = {
  newPassword: string
  confirmPassword: string
  passwordSetupMessage: string
  isSavingPassword: boolean
  onNewPasswordChange: (value: string) => void
  onConfirmPasswordChange: (value: string) => void
  onSavePassword: () => void
}

export function PasswordSetupPage({
  newPassword,
  confirmPassword,
  passwordSetupMessage,
  isSavingPassword,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onSavePassword,
}: PasswordSetupPageProps) {
  return (
    <main dir="rtl" className="ds-page-shell ds-page-shell--narrow">
      <section className="ds-card ds-card--flat">
        <h1 className="ds-card__title">הגדרת סיסמה</h1>
        <p className="ds-card__subtitle">ברוכה הבאה! נא לבחור סיסמה חדשה לחשבון שלך.</p>

        <label className="ds-field">
          <span className="ds-label">סיסמה חדשה</span>
          <input
            className="ds-input"
            placeholder="סיסמה חדשה"
            type="password"
            value={newPassword}
            onChange={(e) => onNewPasswordChange(e.target.value)}
          />
        </label>

        <label className="ds-field">
          <span className="ds-label">אימות סיסמה</span>
          <input
            className="ds-input"
            placeholder="אימות סיסמה"
            type="password"
            value={confirmPassword}
            onChange={(e) => onConfirmPasswordChange(e.target.value)}
          />
        </label>

        <button className="ds-btn ds-btn--primary" onClick={onSavePassword} disabled={isSavingPassword}>
          {isSavingPassword ? 'שומרת...' : 'שמירת סיסמה'}
        </button>

        {passwordSetupMessage && <p className="ds-form-message">{passwordSetupMessage}</p>}
      </section>
    </main>
  )
}
