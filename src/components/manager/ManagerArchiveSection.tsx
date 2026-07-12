import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ManagerPersonalArchivedRequest,
  ManagerPersonalArchiveFilters,
} from '../../types/managerPersonalArchive'
import { loadManagerPersonalArchivedRequests } from '../../services/managerPersonalArchive'
import { filterManagerPersonalArchivedRequests } from '../../utils/requests'
import { NavArchiveIcon } from '../dashboard/dashboardNav'
import { DashboardCollapsibleSection } from '../dashboard/DashboardCollapsibleSection'
import { SecretaryArchiveFilters as ManagerArchiveFiltersPanel } from '../secretary/SecretaryArchiveFilters'
import { SecretaryArchiveTable } from '../secretary/SecretaryArchiveTable'

const defaultFilters: ManagerPersonalArchiveFilters = {
  teacherNameQuery: '',
  requestType: 'all',
  requestStatus: 'all',
  dateFrom: '',
  dateTo: '',
}

const ARCHIVE_PAGE_SIZE = 20

type ManagerArchiveSectionProps = {
  refreshToken: number
}

export function ManagerArchiveSection({ refreshToken }: ManagerArchiveSectionProps) {
  const [requests, setRequests] = useState<ManagerPersonalArchivedRequest[]>([])
  const [filters, setFilters] = useState<ManagerPersonalArchiveFilters>(defaultFilters)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const fetchArchive = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadManagerPersonalArchivedRequests({
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

  function handleFiltersChange(next: ManagerPersonalArchiveFilters) {
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
    () => filterManagerPersonalArchivedRequests(requests, filters),
    [requests, filters],
  )

  const totalPages = Math.max(1, Math.ceil(totalCount / ARCHIVE_PAGE_SIZE))
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * ARCHIVE_PAGE_SIZE + 1
  const rangeEnd = Math.min(page * ARCHIVE_PAGE_SIZE, totalCount)
  const hasPreviousPage = page > 1
  const hasNextPage = page < totalPages

  const emptyMessage =
    totalCount === 0 ? 'אין בקשות בארכיון האישי שלך.' : 'לא נמצאו בקשות התואמות לסינון.'

  return (
    <section className="ds-card manager-dashboard__archive" aria-label="הארכיון שלי">
      <DashboardCollapsibleSection
        title="הארכיון שלי"
        icon={<NavArchiveIcon />}
        className="dashboard-collapsible-section--flush-header"
      >
        <ManagerArchiveFiltersPanel filters={filters} onFiltersChange={handleFiltersChange} />

        {isLoading && <p className="manager-dashboard__insight-status">טוען ארכיון...</p>}

        {!isLoading && loadError && (
          <p className="manager-dashboard__insight-status ds-form-message ds-form-message--error">
            {loadError}
          </p>
        )}

        {!isLoading && !loadError && (
          <>
            <div className="manager-dashboard__archive-pagination-summary">
              {totalCount === 0 ? (
                <p className="manager-dashboard__insight-status">אין בקשות בארכיון האישי שלך.</p>
              ) : (
                <p className="manager-dashboard__insight-status">
                  מציגות {rangeStart}–{rangeEnd} מתוך {totalCount} בקשות (עמוד {page} מתוך{' '}
                  {totalPages})
                </p>
              )}
            </div>

            <SecretaryArchiveTable requests={filteredRequests} emptyMessage={emptyMessage} />

            {totalCount > 0 && (
              <div className="manager-dashboard__archive-pagination">
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
      </DashboardCollapsibleSection>
    </section>
  )
}
