import './DashboardTopHeader.css'

type DashboardTopHeaderProps = {
  welcomeMessage?: string
  roleSubtitle: string
  userDisplayName?: string
  onLogout: () => void
  showSearch?: boolean
}

export function DashboardTopHeader({
  welcomeMessage,
  roleSubtitle,
  userDisplayName,
  onLogout,
  showSearch = true,
}: DashboardTopHeaderProps) {
  const cleanWelcomeMessage = welcomeMessage?.trim() ? `${welcomeMessage.trim()} 👋` : 'ברוכה הבאה 👋'
  const cleanRoleSubtitle = roleSubtitle.replace('אזור מנהלת', 'אזור המנהלת')

  return (
    <header className="dashboard-top-header" aria-label="אזור כותרת עליונה">
      <div className="dashboard-top-header__identity">
        <p className="dashboard-top-header__welcome">{cleanWelcomeMessage}</p>
        <h1 className="dashboard-top-header__role">{cleanRoleSubtitle}</h1>
        {userDisplayName ? <p className="dashboard-top-header__user">{userDisplayName}</p> : null}
      </div>

      <div className="dashboard-top-header__actions">
        {showSearch ? (
          <label className="dashboard-top-header__search" aria-label="חיפוש">
            <span className="dashboard-top-header__search-icon" aria-hidden="true">
              🔎
            </span>
            <input
              type="search"
              className="dashboard-top-header__search-input"
              placeholder="חיפוש..."
              aria-label="חיפוש"
            />
          </label>
        ) : null}

        <button type="button" className="ds-btn ds-btn--secondary" onClick={onLogout}>
          התנתקות
        </button>
      </div>
    </header>
  )
}
