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

type SecretaryArchiveSectionProps = {
  refreshToken: number
}

export function SecretaryArchiveSection({ refreshToken }: SecretaryArchiveSectionProps) {
  const [requests, setRequests] = useState<SecretaryArchivedRequest[]>([])
  const [filters, setFilters] = useState<SecretaryArchiveFilters>(defaultFilters)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const fetchArchive = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadSecretaryArchivedRequests()

    if (!result.ok) {
      setRequests([])
      setLoadError(result.errorMessage)
    } else {
      setRequests(result.requests)
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchArchive()
    })
  }, [fetchArchive, refreshToken])

  const filteredRequests = useMemo(
    () => filterSecretaryArchivedRequests(requests, filters),
    [requests, filters],
  )

  const emptyMessage =
    requests.length === 0
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

      <SecretaryArchiveFiltersPanel filters={filters} onFiltersChange={setFilters} />

      {isLoading && <p className="secretary-dashboard__status">טוען ארכיון...</p>}

      {!isLoading && loadError && (
        <p className="secretary-dashboard__status secretary-dashboard__status--error">
          {loadError}
        </p>
      )}

      {!isLoading && !loadError && (
        <SecretaryArchiveTable requests={filteredRequests} emptyMessage={emptyMessage} />
      )}
    </section>
  )
}
