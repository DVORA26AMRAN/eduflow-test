import type { PrimaryRole } from '../../types/user'
import type { School } from '../../types/school'
import { getDisplayInitial } from '../../utils/displayInitial'
import { SchoolLogo } from '../SchoolLogo'
import './DashboardTopHeader.css'

type DashboardTopHeaderProps = {
  roleSubtitle: string
  userDisplayName?: string
  role?: PrimaryRole
  school?: School | null
  onLogout: () => void
  /** @deprecated Search removed from compact header reference layout */
  showSearch?: boolean
  /** @deprecated Replaced by compact greeting line */
  welcomeMessage?: string
}

export function DashboardTopHeader({
  roleSubtitle,
  userDisplayName,
  role,
  school,
  onLogout,
}: DashboardTopHeaderProps) {
  const cleanRoleSubtitle = roleSubtitle.replace('אזור מנהלת', 'אזור המנהלת')
  const displayName = userDisplayName?.trim() || 'משתמשת'
  const schoolName = school?.name?.trim() || 'בית הספר'
  const avatarInitial = getDisplayInitial(userDisplayName)

  return (
    <header
      className="dashboard-top-header"
      data-role={role}
      aria-label="אזור כותרת עליונה"
    >
      <div className="dashboard-top-header__leading">
        <SchoolLogo
          schoolName={schoolName}
          logoUrl={school?.logoUrl}
          size="header"
          placeholderVariant="icon"
        />

        <span
          className="dashboard-top-header__avatar"
          role="img"
          aria-label={`תמונת פרופיל של ${displayName}`}
        >
          {avatarInitial}
        </span>

        <div className="dashboard-top-header__identity">
          <p className="dashboard-top-header__greeting">שלום, {displayName}</p>
          <p className="dashboard-top-header__role">{cleanRoleSubtitle}</p>
        </div>
      </div>

      <div className="dashboard-top-header__spacer" aria-hidden="true" />

      <div className="dashboard-top-header__actions">
        <button type="button" className="ds-btn ds-btn--secondary" onClick={onLogout}>
          התנתקות
        </button>
      </div>
    </header>
  )
}
