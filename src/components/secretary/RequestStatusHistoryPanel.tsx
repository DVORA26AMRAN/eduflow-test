import type { RequestStatusHistoryEntry } from '../../types/request'
import { formatRequestDateTime, translateRequestStatus } from '../../utils/requests'

type RequestStatusHistoryPanelProps = {
  isOpen: boolean
  isLoading: boolean
  errorMessage: string
  entries: RequestStatusHistoryEntry[]
  onClose: () => void
}

export function RequestStatusHistoryPanel({
  isOpen,
  isLoading,
  errorMessage,
  entries,
  onClose,
}: RequestStatusHistoryPanelProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div
      className="secretary-dashboard__history-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="secretary-dashboard__history-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-history-title"
      >
        <header className="secretary-dashboard__history-header">
          <h3 id="request-history-title" className="secretary-dashboard__history-title">
            היסטוריית סטטוסים
          </h3>
          <button
            type="button"
            className="ds-btn ds-btn--secondary secretary-dashboard__history-close"
            onClick={onClose}
          >
            סגירה
          </button>
        </header>

        {isLoading && (
          <p className="secretary-dashboard__history-status">טוען היסטוריית סטטוסים...</p>
        )}

        {!isLoading && errorMessage && (
          <p className="secretary-dashboard__history-status secretary-dashboard__status--error">
            {errorMessage}
          </p>
        )}

        {!isLoading && !errorMessage && entries.length === 0 && (
          <div className="ds-state secretary-dashboard__history-empty-state">
            <span className="ds-state__icon" aria-hidden="true">
              🕘
            </span>
            <p className="ds-state__title">אין היסטוריית סטטוסים לבקשה זו.</p>
          </div>
        )}

        {!isLoading && !errorMessage && entries.length > 0 && (
          <ul className="secretary-dashboard__history-list">
            {entries.map((entry) => (
              <li key={entry.id} className="secretary-dashboard__history-item">
                <p className="secretary-dashboard__history-transition">
                  <span className={`ds-table__status ds-table__status--${entry.previous_status}`}>
                    {translateRequestStatus(entry.previous_status)}
                  </span>{' '}
                  ←{' '}
                  <span className={`ds-table__status ds-table__status--${entry.new_status}`}>
                    {translateRequestStatus(entry.new_status)}
                  </span>
                </p>
                {entry.changed_by_full_name && (
                  <p className="secretary-dashboard__history-meta">
                    שונתה על ידי: {entry.changed_by_full_name}
                  </p>
                )}
                <p className="secretary-dashboard__history-meta">
                  {formatRequestDateTime(entry.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
