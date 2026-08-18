import { useEffect, useState } from 'react'
import { formatHandlerHistoryMessage } from '../../domain/requestOwnership'
import { loadRequestHandlerHistory } from '../../services/requestOwnership'
import type { RequestHandlerHistoryEntry } from '../../types/requestOwnership'
import { formatRequestDateTime } from '../../utils/requests'
import './RequestHandlerControls.css'

type RequestHandlerHistorySectionProps = {
  requestId: string
  isActive: boolean
}

export function RequestHandlerHistorySection({
  requestId,
  isActive,
}: RequestHandlerHistorySectionProps) {
  const [entries, setEntries] = useState<RequestHandlerHistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!isActive) {
      return
    }

    let cancelled = false

    queueMicrotask(() => {
      void (async () => {
        setIsLoading(true)
        const result = await loadRequestHandlerHistory(requestId)
        if (cancelled) {
          return
        }

        setIsLoading(false)
        setEntries(result.ok ? result.entries : [])
      })()
    })

    return () => {
      cancelled = true
    }
  }, [isActive, requestId])

  if (!isLoading && entries.length === 0) {
    return null
  }

  return (
    <section className="request-details__section" aria-label="היסטוריית טיפול">
      <h3 className="request-details__section-title">היסטוריית טיפול</h3>

      {isLoading ? (
        <p className="request-details__status">טוען היסטוריית טיפול...</p>
      ) : (
        <ul className="request-handler-history">
          {entries.map((entry) => (
            <li key={entry.id} className="request-handler-history__item">
              <p className="request-details__history-transition">
                {formatHandlerHistoryMessage(entry)}
              </p>
              <p className="request-details__history-meta">
                {formatRequestDateTime(entry.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
