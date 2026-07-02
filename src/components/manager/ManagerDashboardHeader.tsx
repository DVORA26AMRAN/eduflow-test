type ManagerDashboardHeaderProps = {
  onLogout: () => void
}

export function ManagerDashboardHeader({ onLogout }: ManagerDashboardHeaderProps) {
  return (
    <header className="manager-dashboard__header">
      <div className="manager-dashboard__header-text">
        <h1 className="manager-dashboard__brand">EduFlow</h1>
        <p className="ds-card__subtitle manager-dashboard__welcome">
          ברוכה הבאה ל־EduFlow.
        </p>
      </div>
      <button
        type="button"
        className="ds-btn ds-btn--secondary manager-dashboard__logout"
        onClick={onLogout}
      >
        התנתקות
      </button>
    </header>
  )
}
