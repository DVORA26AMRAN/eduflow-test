import type { ReactNode } from 'react'

type DashboardMetricCardProps = {
  label: string
  value: string | number
  icon?: ReactNode
  onClick?: () => void
  ariaLabel?: string
}

export function DashboardMetricCard({
  label,
  value,
  icon,
  onClick,
  ariaLabel,
}: DashboardMetricCardProps) {
  const content = (
    <>
      <p className="dashboard-analytics__metric-label">
        {icon ? (
          <span className="dashboard-card__title-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {label}
      </p>
      <p className="dashboard-analytics__metric-value">{value}</p>
    </>
  )

  if (!onClick) {
    return <article className="ds-card dashboard-analytics__metric-card">{content}</article>
  }

  return (
    <article className="ds-card dashboard-analytics__metric-card">
      <button
        type="button"
        className="dashboard-analytics__metric-button"
        aria-label={ariaLabel ?? `${label}: ${value}`}
        onClick={onClick}
      >
        {content}
      </button>
    </article>
  )
}
