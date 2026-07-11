import { useId, useState, type ReactNode } from 'react'
import './DashboardCollapsibleSection.css'

type DashboardCollapsibleSectionProps = {
  title: string
  icon?: ReactNode
  ariaLabel?: string
  headerAddon?: ReactNode
  className?: string
  defaultExpanded?: boolean
  children: ReactNode
}

function CollapseChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

export function DashboardCollapsibleSection({
  title,
  icon,
  ariaLabel,
  headerAddon,
  className,
  defaultExpanded = false,
  children,
}: DashboardCollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const bodyId = useId()

  return (
    <div
      className={['dashboard-collapsible-section', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
    >
      <div className="dashboard-collapsible-section__header">
        <h2 className="dashboard-collapsible-section__heading">
          <button
            type="button"
            className="dashboard-collapsible-section__toggle"
            aria-expanded={isExpanded}
            aria-controls={bodyId}
            onClick={() => setIsExpanded((current) => !current)}
          >
            <span className="dashboard-collapsible-section__title-group">
              {icon ? (
                <span className="dashboard-card__title-icon" aria-hidden="true">
                  {icon}
                </span>
              ) : null}
              {title}
            </span>
            <span
              className={[
                'dashboard-collapsible-section__chevron',
                isExpanded ? 'dashboard-collapsible-section__chevron--expanded' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-hidden="true"
            >
              <CollapseChevronIcon />
            </span>
          </button>
        </h2>
        {headerAddon ? (
          <div className="dashboard-collapsible-section__header-addon">{headerAddon}</div>
        ) : null}
      </div>

      <div
        id={bodyId}
        className={[
          'dashboard-collapsible-section__body',
          isExpanded ? 'dashboard-collapsible-section__body--expanded' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-hidden={!isExpanded}
        {...(!isExpanded ? { inert: true } : {})}
      >
        <div className="dashboard-collapsible-section__inner">{children}</div>
      </div>
    </div>
  )
}
