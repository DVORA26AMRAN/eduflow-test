import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SecretaryArchiveFilters, SecretaryArchivedRequest } from '../../types/request'
import { loadSecretaryArchivedRequests } from '../../services/requests'
import { filterSecretaryArchivedRequests } from '../../utils/requests'
import { NavArchiveIcon } from '../dashboard/dashboardNav'
import { SecretaryArchiveFilters as SecretaryArchiveFiltersPanel } from './SecretaryArchiveFilters'
import { SecretaryArchiveTable } from './SecretaryArchiveTable'

const defaultFilters: SecretaryArchiveFilters = {
  teacherNameQuery: '',
  requestType: 'all',
  requestStatus: 'all',
  dateFrom: '',
  dateTo: '',
}

const ARCHIVE_PAGE_SIZE = 20

type SecretaryArchiveSectionProps = {
  refreshToken: number
}

export function SecretaryArchiveSection({ refreshToken }: SecretaryArchiveSectionProps) {
  const [requests, setRequests] = useState<SecretaryArchivedRequest[]>([])
  const [filters, setFilters] = useState<SecretaryArchiveFilters>(defaultFilters)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const fetchArchive = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadSecretaryArchivedRequests({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      page,
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
  }, [filters.dateFrom, filters.dateTo, page])

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

  const totalPages = Math.max(1, Math.ceil(totalCount / ARCHIVE_PAGE_SIZE))
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * ARCHIVE_PAGE_SIZE + 1
  const rangeEnd = Math.min(page * ARCHIVE_PAGE_SIZE, totalCount)
  const hasPreviousPage = page > 1
  const hasNextPage = page < totalPages

  const emptyMessage =
    totalCount === 0
      ? 'אין בקשות בארכיון המוסדי.'
      : 'לא נמצאו בקשות התואמות לסינון.'

  return (
    <section className="ds-card secretary-dashboard__archive" aria-label="ארכיון מוסדי">
      <h2 className="secretary-dashboard__section-title">
        <span className="dashboard-card__title-icon" aria-hidden="true">
          <NavArchiveIcon />
        </span>
        ארכיון מוסדי
      </h2>

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
                מציגות {rangeStart}–{rangeEnd} מתוך {totalCount} בקשות (עמוד {page} מתוך{' '}
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
    </section>
  )
}
