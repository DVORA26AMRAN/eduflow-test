import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SecretaryArchiveFilters, SecretaryArchivedRequest } from '../../types/request'
import type { ReminderNavigationIntent } from '../../types/reminderNavigation'
import { loadSecretaryArchivedRequests } from '../../services/requests'
import { INSTITUTIONAL_ARCHIVE_PAGE_SIZE } from '../../services/reminderRequestLocation'
import { filterSecretaryArchivedRequests } from '../../utils/requests'
import {
  SECRETARY_ARCHIVE_DEFAULT_FILTERS,
  shouldResetArchiveFilters,
} from '../../utils/reminderNavigation'
import { useRequestReminderNavigationEffect } from '../../hooks/useRequestReminderNavigationEffect'
import { NavArchiveIcon } from '../dashboard/dashboardNav'
import { DashboardSection } from '../dashboard/DashboardSection'
import { SecretaryArchiveFilters as SecretaryArchiveFiltersPanel } from './SecretaryArchiveFilters'
import { SecretaryArchiveTable } from './SecretaryArchiveTable'

const defaultFilters = SECRETARY_ARCHIVE_DEFAULT_FILTERS

const ARCHIVE_PAGE_SIZE = INSTITUTIONAL_ARCHIVE_PAGE_SIZE

type SecretaryArchiveSectionProps = {
  refreshToken: number
  reminderNavigationIntent?: ReminderNavigationIntent | null
  onReminderNavigationComplete?: (token: number, found: boolean) => void
}

export function SecretaryArchiveSection({
  refreshToken,
  reminderNavigationIntent = null,
  onReminderNavigationComplete,
}: SecretaryArchiveSectionProps) {
  const [requests, setRequests] = useState<SecretaryArchivedRequest[]>([])
  const [filters, setFilters] = useState<SecretaryArchiveFilters>(defaultFilters)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const effectivePage =
    reminderNavigationIntent?.location.kind === 'secretary_institutional_archive'
      ? reminderNavigationIntent.location.page
      : page

  const fetchArchive = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadSecretaryArchivedRequests({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      page: effectivePage,
      pageSize: ARCHIVE_PAGE_SIZE,
    })

    if (!result.ok) {
      setRequests([])
      setTotalCount(0)
      setLoadError(result.errorMessage)
    } else {
      setRequests(result.requests)
      setTotalCount(result.totalCount)
    }

    setIsLoading(false)
  }, [filters.dateFrom, filters.dateTo, effectivePage])

  function handleFiltersChange(next: SecretaryArchiveFilters) {
    const datesChanged =
      next.dateFrom !== filters.dateFrom || next.dateTo !== filters.dateTo

    if (datesChanged) {
      setPage(1)
    }

    setFilters(next)
  }

  useEffect(() => {
    queueMicrotask(() => {
      void fetchArchive()
    })
  }, [fetchArchive, refreshToken])

  const filteredRequests = useMemo(
    () => filterSecretaryArchivedRequests(requests, filters),
    [requests, filters],
  )

  const filteredRequestIds = useMemo(
    () => new Set(filteredRequests.map((request) => request.id)),
    [filteredRequests],
  )

  const handleReminderNavigationComplete = useCallback(
    (token: number, found: boolean) => {
      onReminderNavigationComplete?.(token, found)
    },
    [onReminderNavigationComplete],
  )

  const revealReminderRequest = useCallback(
    (requestId: string) => {
      if (shouldResetArchiveFilters(filters, requestId, requests, filteredRequestIds)) {
        setFilters(defaultFilters)
      }
    },
    [filters, requests, filteredRequestIds],
  )

  useRequestReminderNavigationEffect({
    intent: reminderNavigationIntent,
    expectedLocationKind: 'secretary_institutional_archive',
    isReady: !isLoading && !loadError,
    isRequestInDataset: (requestId) => requests.some((request) => request.id === requestId),
    isRequestVisible: (requestId) => filteredRequestIds.has(requestId),
    revealRequest: revealReminderRequest,
    onComplete: handleReminderNavigationComplete,
  })

  const totalPages = Math.max(1, Math.ceil(totalCount / ARCHIVE_PAGE_SIZE))
  const rangeStart = totalCount === 0 ? 0 : (effectivePage - 1) * ARCHIVE_PAGE_SIZE + 1
  const rangeEnd = Math.min(effectivePage * ARCHIVE_PAGE_SIZE, totalCount)
  const hasPreviousPage = effectivePage > 1
  const hasNextPage = effectivePage < totalPages

  const emptyMessage =
    totalCount === 0
      ? 'אין בקשות בארכיון המוסדי.'
      : 'לא נמצאו בקשות התואמות לסינון.'

  return (
    <section className="ds-card secretary-dashboard__archive" aria-label="ארכיון מוסדי">
      <DashboardSection
        title="ארכיון מוסדי"
        icon={<NavArchiveIcon />}
        className="dashboard-section--flush-header"
      >
        <SecretaryArchiveFiltersPanel filters={filters} onFiltersChange={handleFiltersChange} />

        {isLoading && <p className="secretary-dashboard__status">טוען ארכיון...</p>}

        {!isLoading && loadError && (
          <p className="secretary-dashboard__status secretary-dashboard__status--error">
            {loadError}
          </p>
        )}

        {!isLoading && !loadError && (
          <>
            <div className="secretary-dashboard__archive-pagination-summary">
              {totalCount === 0 ? (
                <p className="secretary-dashboard__status">אין בקשות בארכיון המוסדי.</p>
              ) : (
                <p className="secretary-dashboard__status">
                  מציגות {rangeStart}–{rangeEnd} מתוך {totalCount} בקשות (עמוד {effectivePage} מתוך{' '}
                  {totalPages})
                </p>
              )}
            </div>

            <SecretaryArchiveTable requests={filteredRequests} emptyMessage={emptyMessage} />

            {totalCount > 0 && (
              <div className="secretary-dashboard__archive-pagination">
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => setPage((currentPage) => currentPage - 1)}
                  disabled={!hasPreviousPage || isLoading}
                >
                  הקודם
                </button>
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => setPage((currentPage) => currentPage + 1)}
                  disabled={!hasNextPage || isLoading}
                >
                  הבא
                </button>
              </div>
            )}
          </>
        )}
      </DashboardSection>
    </section>
  )
}
