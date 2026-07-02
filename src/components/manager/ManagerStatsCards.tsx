type ManagerStatsCardsProps = {
  teachersCount: number
  secretariesCount: number
  activeRequestsCount: number
}

export function ManagerStatsCards({
  teachersCount,
  secretariesCount,
  activeRequestsCount,
}: ManagerStatsCardsProps) {
  return (
    <section className="manager-dashboard__stats" aria-label="סטטיסטיקות">
      <article className="ds-card manager-dashboard__stat-card">
        <p className="manager-dashboard__stat-label">מורים</p>
        <p className="manager-dashboard__stat-value">{teachersCount}</p>
      </article>
      <article className="ds-card manager-dashboard__stat-card">
        <p className="manager-dashboard__stat-label">מזכירות</p>
        <p className="manager-dashboard__stat-value">{secretariesCount}</p>
      </article>
      <article className="ds-card ds-card--accent manager-dashboard__stat-card">
        <p className="manager-dashboard__stat-label">בקשות פעילות</p>
        <p className="manager-dashboard__stat-value">{activeRequestsCount}</p>
      </article>
    </section>
  )
}
