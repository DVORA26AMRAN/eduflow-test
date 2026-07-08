import type { ManagerAnalytics } from '../../types/analytics'
import type { ReactNode } from 'react'
import {
  NavActivityIcon,
  NavBellIcon,
  NavChartIcon,
  NavClipboardIcon,
  NavUsersIcon,
} from '../dashboard/dashboardNav'

type ManagerStatsCardsProps = {
  analytics: ManagerAnalytics | null
  isLoading: boolean
  errorMessage: string
}

type StatCard = {
  label: string
  value: number
  icon: ReactNode
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
    { label: 'מספר מורים פעילים', value: analytics.activeTeachersCount, icon: <NavUsersIcon /> },
    { label: 'מספר מזכירות פעילות', value: analytics.activeSecretariesCount, icon: <NavUsersIcon /> },
    { label: 'סך הבקשות', value: analytics.totalRequestsCount, icon: <NavChartIcon /> },
    { label: 'בקשות חדשות', value: analytics.newRequestsCount, icon: <NavBellIcon /> },
    { label: 'בקשות בטיפול', value: analytics.inProgressRequestsCount, icon: <NavActivityIcon /> },
    { label: 'בקשות שהושלמו', value: analytics.completedRequestsCount, icon: <NavClipboardIcon /> },
    { label: 'בקשות שנדחו', value: analytics.rejectedRequestsCount, icon: <NavClipboardIcon /> },
  ]

  return (
    <section className="manager-dashboard__stats" aria-label="סטטיסטיקות">
      {cards.map((card) => (
        <article key={card.label} className="ds-card manager-dashboard__stat-card">
          <p className="manager-dashboard__stat-label">
            <span className="dashboard-card__title-icon" aria-hidden="true">
              {card.icon}
            </span>
            {card.label}
          </p>
          <p className="manager-dashboard__stat-value">{card.value}</p>
        </article>
      ))}
    </section>
  )
}
