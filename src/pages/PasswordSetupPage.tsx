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
    <main dir="rtl" style={{ padding: 40, maxWidth: 500 }}>
      <h1>הגדרת סיסמה</h1>
      <p>ברוכה הבאה! נא לבחור סיסמה חדשה לחשבון שלך.</p>

      <input
        placeholder="סיסמה חדשה"
        type="password"
        value={newPassword}
        onChange={(e) => onNewPasswordChange(e.target.value)}
        style={{ display: 'block', width: '100%', marginBottom: 12 }}
      />

      <input
        placeholder="אימות סיסמה"
        type="password"
        value={confirmPassword}
        onChange={(e) => onConfirmPasswordChange(e.target.value)}
        style={{ display: 'block', width: '100%', marginBottom: 12 }}
      />

      <button onClick={onSavePassword} disabled={isSavingPassword}>
        {isSavingPassword ? 'שומרת...' : 'שמירת סיסמה'}
      </button>

      {passwordSetupMessage && <p>{passwordSetupMessage}</p>}
    </main>
  )
}
