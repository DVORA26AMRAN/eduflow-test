import type { ProfileLoadDebugInfo } from '../types/user'

type ProfileLoadErrorPageProps = {
  errorMessage: string
  debugInfo: ProfileLoadDebugInfo | null
}

export function ProfileLoadErrorPage({
  errorMessage,
  debugInfo,
}: ProfileLoadErrorPageProps) {
  return (
    <main dir="rtl" className="ds-page-shell">
      <section className="ds-state ds-state--error" role="status" aria-live="polite">
        <h1 className="ds-state__title">שגיאה</h1>
        <p className="ds-state__message">{errorMessage}</p>
      </section>

      {debugInfo && (
        <section className="ds-debug-panel">
          <h2>פרטי ניפוי שגיאות</h2>
          <p>
            <strong>מזהה משתמש בהפעלה:</strong>{' '}
            {debugInfo.sessionUserId ?? '—'}
          </p>
          <p>
            <strong>אימייל בהפעלה:</strong> {debugInfo.sessionEmail ?? '—'}
          </p>
          <p>
            <strong>מזהה בשאילתת users:</strong>{' '}
            {debugInfo.queryUserId ?? '—'}
          </p>
          <p>
            <strong>הודעת שגיאה:</strong> {debugInfo.errorMessage ?? '—'}
          </p>
          <p>
            <strong>קוד שגיאה:</strong> {debugInfo.errorCode ?? '—'}
          </p>
          <p>
            <strong>האם data היה null:</strong>{' '}
            {debugInfo.dataWasNull ? 'כן' : 'לא'}
          </p>
        </section>
      )}
    </main>
  )
}
