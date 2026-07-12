import { useEffect, useState } from 'react'
import type { RequestStatusHistoryEntry } from '../../types/request'
import { loadRequestStatusHistory } from '../../services/requests'
import { formatRequestDateTime, translateRequestStatus } from '../../utils/requests'

type RequestDetailsHistorySectionProps = {
  requestId: string
  isActive: boolean
  onLastUpdateLoaded?: (isoDate: string | null) => void
}

export function RequestDetailsHistorySection({
  requestId,
  isActive,
  onLastUpdateLoaded,
}: RequestDetailsHistorySectionProps) {
  const [entries, setEntries] = useState<RequestStatusHistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!isActive) {
      return
    }

    let isCancelled = false

    queueMicrotask(() => {
      void (async () => {
        setIsLoading(true)
        setErrorMessage('')

        const result = await loadRequestStatusHistory(requestId)

        if (isCancelled) {
          return
        }

        setIsLoading(false)

        if (!result.ok) {
          setEntries([])
          setErrorMessage(result.errorMessage)
          onLastUpdateLoaded?.(null)
          return
        }

        setEntries(result.entries)
        onLastUpdateLoaded?.(result.entries[0]?.created_at ?? null)
      })()
    })

    return () => {
      isCancelled = true
    }
  }, [isActive, onLastUpdateLoaded, requestId])

  return (
    <section className="request-details__section" aria-label="היסטוריית סטטוסים">
      <h3 className="request-details__section-title">היסטוריית סטטוסים</h3>

      {isLoading && (
        <p className="request-details__status">טוען היסטוריית סטטוסים...</p>
      )}

      {!isLoading && errorMessage && (
        <p className="request-details__status request-details__status--error">{errorMessage}</p>
      )}

      {!isLoading && !errorMessage && entries.length === 0 && (
        <div className="ds-state request-details__empty-state">
          <span className="ds-state__icon" aria-hidden="true">
            🕘
          </span>
          <p className="ds-state__title">אין היסטוריית סטטוסים לבקשה זו.</p>
        </div>
      )}

      {!isLoading && !errorMessage && entries.length > 0 && (
        <ul className="request-details__history-list">
          {entries.map((entry) => (
            <li key={entry.id} className="request-details__history-item">
              <p className="request-details__history-transition">
                <span className={`ds-table__status ds-table__status--${entry.previous_status}`}>
                  {translateRequestStatus(entry.previous_status)}
                </span>{' '}
                ←{' '}
                <span className={`ds-table__status ds-table__status--${entry.new_status}`}>
                  {translateRequestStatus(entry.new_status)}
                </span>
              </p>
              {entry.changed_by_full_name && (
                <p className="request-details__history-meta">
                  שונתה על ידי: {entry.changed_by_full_name}
                </p>
              )}
              <p className="request-details__history-meta">
                {formatRequestDateTime(entry.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
