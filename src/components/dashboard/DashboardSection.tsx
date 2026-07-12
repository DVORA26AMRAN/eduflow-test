import type { ReactNode } from 'react'
import './DashboardSection.css'

type DashboardSectionProps = {
  title: string
  icon?: ReactNode
  ariaLabel?: string
  headerAddon?: ReactNode
  className?: string
  children: ReactNode
}

export function DashboardSection({
  title,
  icon,
  ariaLabel,
  headerAddon,
  className,
  children,
}: DashboardSectionProps) {
  return (
    <div
      className={['dashboard-section', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
    >
      <div className="dashboard-section__header">
        <h2 className="dashboard-section__heading">
          <span className="dashboard-section__title-group">
            {icon ? (
              <span className="dashboard-card__title-icon" aria-hidden="true">
                {icon}
              </span>
            ) : null}
            {title}
          </span>
        </h2>
        {headerAddon ? (
          <div className="dashboard-section__header-addon">{headerAddon}</div>
        ) : null}
      </div>

      <div className="dashboard-section__body">
        <div className="dashboard-section__inner">{children}</div>
      </div>
    </div>
  )
}
