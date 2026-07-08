import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ArchiveFilters, ArchivedTeacherRequest } from '../../types/request'
import { loadMyArchivedRequests } from '../../services/requests'
import { filterArchivedTeacherRequests } from '../../utils/requests'
import { NavArchiveIcon } from '../dashboard/dashboardNav'
import { TeacherArchiveDetails } from './TeacherArchiveDetails'
import { TeacherArchiveFilters } from './TeacherArchiveFilters'
import { TeacherArchiveList } from './TeacherArchiveList'

const defaultFilters: ArchiveFilters = {
  requestType: 'all',
  requestStatus: 'all',
  dateFrom: '',
  dateTo: '',
}

export function TeacherArchiveSection() {
  const [requests, setRequests] = useState<ArchivedTeacherRequest[]>([])
  const [filters, setFilters] = useState<ArchiveFilters>(defaultFilters)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const fetchArchive = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadMyArchivedRequests()

    if (!result.ok) {
      setRequests([])
      setSelectedRequestId(null)
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
  }, [fetchArchive])

  const filteredRequests = useMemo(
    () => filterArchivedTeacherRequests(requests, filters),
    [requests, filters],
  )

  const selectedRequest =
    filteredRequests.find((request) => request.id === selectedRequestId) ?? null

  const emptyMessage =
    requests.length === 0
      ? 'אין פריטים בארכיון.'
      : 'לא נמצאו פריטים התואמים לסינון.'

  return (
    <section className="teacher-dashboard__archive" aria-label="הארכיון שלי">
      <h2 className="teacher-dashboard__section-title">
        <span className="dashboard-card__title-icon" aria-hidden="true">
          <NavArchiveIcon />
        </span>
        הארכיון שלי
      </h2>

      <div className="ds-card teacher-dashboard__archive-card">
        <TeacherArchiveFilters filters={filters} onFiltersChange={setFilters} />

        {isLoading && <p className="ds-form-message">טוען ארכיון...</p>}

        {!isLoading && loadError && (
          <p className="ds-form-message ds-form-message--error">{loadError}</p>
        )}

        {!isLoading && !loadError && (
          <div className="teacher-dashboard__archive-layout">
            <TeacherArchiveList
              requests={filteredRequests}
              selectedRequestId={selectedRequest?.id ?? null}
              emptyMessage={emptyMessage}
              onSelect={setSelectedRequestId}
            />
            <TeacherArchiveDetails request={selectedRequest} />
          </div>
        )}
      </div>
    </section>
  )
}
