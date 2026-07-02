type SecretaryDashboardHeaderProps = {
  onLogout: () => void
}

export function SecretaryDashboardHeader({ onLogout }: SecretaryDashboardHeaderProps) {
  return (
    <header className="secretary-dashboard__header">
      <div className="secretary-dashboard__header-text">
        <h1 className="secretary-dashboard__title">EduFlow</h1>
        <p className="secretary-dashboard__welcome">ברוכה הבאה לאזור המזכירה ב־EduFlow.</p>
      </div>
      <button type="button" className="secretary-dashboard__logout" onClick={onLogout}>
        התנתקות
      </button>
    </header>
  )
}
