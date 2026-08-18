import type { AuthenticatedUserProfile } from '../types/user'
import { translateRole } from '../utils/roles'

type DeputyDashboardPlaceholderPageProps = {
  profile: AuthenticatedUserProfile
  onLogout: () => void
}

/**
 * D1 safe gate: Deputy is authenticated and parsed, but operational dashboard
 * capabilities are not enabled until D2/D3 authorization exists.
 */
export function DeputyDashboardPlaceholderPage({
  profile,
  onLogout,
}: DeputyDashboardPlaceholderPageProps) {
  return (
    <main dir="rtl" className="ds-page-shell" data-testid="deputy-d1-placeholder">
      <section className="ds-card ds-card--flat">
        <p className="ds-helper-text">{translateRole(profile.role)}</p>
        <h1 className="ds-card__title">דשבורד סגנית בהכנה</h1>
        <p className="ds-card__subtitle">
          שלום, {profile.fullName}. אזור הסגנית יפתח בשלב הבא.
        </p>
        <button type="button" className="ds-btn ds-btn--secondary" onClick={onLogout}>
          התנתקות
        </button>
      </section>
    </main>
  )
}
