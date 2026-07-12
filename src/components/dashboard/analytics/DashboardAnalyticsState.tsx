import type { ReactNode } from 'react'

type DashboardAnalyticsStateProps = {
  isLoading: boolean
  errorMessage: string
  isEmpty: boolean
  emptyMessage: string
  onRetry?: () => void
  children: ReactNode
}

export function DashboardAnalyticsState({
  isLoading,
  errorMessage,
  isEmpty,
  emptyMessage,
  onRetry,
  children,
}: DashboardAnalyticsStateProps) {
  if (isLoading) {
    return <p className="dashboard-analytics__state">טוען נתונים...</p>
  }

  if (errorMessage) {
    return (
      <div className="dashboard-analytics__state">
        <p className="ds-form-message ds-form-message--error">{errorMessage}</p>
        {onRetry ? (
          <button type="button" className="ds-btn ds-btn--secondary" onClick={onRetry}>
            נסי שוב
          </button>
        ) : null}
      </div>
    )
  }

  if (isEmpty) {
    return <p className="dashboard-analytics__state">{emptyMessage}</p>
  }

  return <>{children}</>
}
