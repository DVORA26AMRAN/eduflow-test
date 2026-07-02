type TeacherDashboardHeaderProps = {
  onLogout: () => void
}

export function TeacherDashboardHeader({ onLogout }: TeacherDashboardHeaderProps) {
  return (
    <header className="teacher-dashboard__header">
      <div className="teacher-dashboard__header-text">
        <h1 className="teacher-dashboard__brand">EduFlow</h1>
        <p className="ds-card__subtitle teacher-dashboard__welcome">
          ברוכה הבאה לאזור המורה ב־EduFlow.
        </p>
      </div>
      <button
        type="button"
        className="ds-btn ds-btn--secondary teacher-dashboard__logout"
        onClick={onLogout}
      >
        התנתקות
      </button>
    </header>
  )
}
