import type { ManagerAnalytics } from '../../types/analytics'

type ManagerStatsCardsProps = {
  analytics: ManagerAnalytics | null
  isLoading: boolean
  errorMessage: string
}

type StatCard = {
  label: string
  value: number
  accent?: boolean
}

export function ManagerStatsCards({
  analytics,
  isLoading,
  errorMessage,
}: ManagerStatsCardsProps) {
  if (isLoading) {
    return <p className="manager-dashboard__analytics-status">טוען נתונים...</p>
  }

  if (errorMessage) {
    return (
      <p className="manager-dashboard__analytics-status ds-form-message ds-form-message--error">
        {errorMessage}
      </p>
    )
  }

  if (!analytics) {
    return null
  }

  const cards: StatCard[] = [
    { label: 'מספר מורים פעילים', value: analytics.activeTeachersCount },
    { label: 'מספר מזכירות פעילות', value: analytics.activeSecretariesCount },
    { label: 'סך הבקשות', value: analytics.totalRequestsCount, accent: true },
    { label: 'בקשות חדשות', value: analytics.newRequestsCount },
    { label: 'בקשות בטיפול', value: analytics.inProgressRequestsCount },
    { label: 'בקשות שהושלמו', value: analytics.completedRequestsCount },
    { label: 'בקשות שנדחו', value: analytics.rejectedRequestsCount },
  ]

  return (
    <section className="manager-dashboard__stats" aria-label="סטטיסטיקות">
      {cards.map((card) => (
        <article
          key={card.label}
          className={
            card.accent
              ? 'ds-card ds-card--accent manager-dashboard__stat-card'
              : 'ds-card manager-dashboard__stat-card'
          }
        >
          <p className="manager-dashboard__stat-label">{card.label}</p>
          <p className="manager-dashboard__stat-value">{card.value}</p>
        </article>
      ))}
    </section>
  )
}
