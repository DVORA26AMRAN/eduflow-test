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
    <main dir="rtl" style={{ padding: 40, maxWidth: 700 }}>
      <h1>שגיאה</h1>
      <p>{errorMessage}</p>

      {debugInfo && (
        <section
          style={{
            marginTop: 24,
            padding: 16,
            border: '1px solid #ccc',
            borderRadius: 8,
            background: '#fafafa',
            fontFamily: 'monospace',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <h2 style={{ marginTop: 0, fontFamily: 'inherit', fontSize: 16 }}>
            פרטי ניפוי שגיאות
          </h2>
          <p style={{ margin: '8px 0' }}>
            <strong>מזהה משתמש בהפעלה:</strong>{' '}
            {debugInfo.sessionUserId ?? '—'}
          </p>
          <p style={{ margin: '8px 0' }}>
            <strong>אימייל בהפעלה:</strong> {debugInfo.sessionEmail ?? '—'}
          </p>
          <p style={{ margin: '8px 0' }}>
            <strong>מזהה בשאילתת users:</strong>{' '}
            {debugInfo.queryUserId ?? '—'}
          </p>
          <p style={{ margin: '8px 0' }}>
            <strong>הודעת שגיאה:</strong> {debugInfo.errorMessage ?? '—'}
          </p>
          <p style={{ margin: '8px 0' }}>
            <strong>קוד שגיאה:</strong> {debugInfo.errorCode ?? '—'}
          </p>
          <p style={{ margin: '8px 0' }}>
            <strong>האם data היה null:</strong>{' '}
            {debugInfo.dataWasNull ? 'כן' : 'לא'}
          </p>
        </section>
      )}
    </main>
  )
}
