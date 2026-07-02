import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SecretaryInboxFilters, SecretaryInboxRequest } from '../../types/request'
import { loadSecretaryRequests } from '../../services/requests'
import { filterSecretaryInboxRequests } from '../../utils/requests'
import { SecretaryRequestsFilters } from './SecretaryRequestsFilters'
import { SecretaryRequestsTable } from './SecretaryRequestsTable'

const defaultFilters: SecretaryInboxFilters = {
  teacherNameQuery: '',
  requestType: 'all',
  requestStatus: 'all',
}

export function SecretaryRequestsInbox() {
  const [requests, setRequests] = useState<SecretaryInboxRequest[]>([])
  const [filters, setFilters] = useState<SecretaryInboxFilters>(defaultFilters)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const fetchRequests = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadSecretaryRequests()

    if (!result.ok) {
      setRequests([])
      setLoadError(result.errorMessage)
    } else {
      setRequests(result.requests)
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    void fetchRequests()
  }, [fetchRequests])

  const filteredRequests = useMemo(
    () => filterSecretaryInboxRequests(requests, filters),
    [requests, filters],
  )

  const emptyMessage =
    requests.length === 0
      ? 'אין בקשות להצגה.'
      : 'לא נמצאו בקשות התואמות לחיפוש.'

  return (
    <section className="secretary-dashboard__inbox">
      <h2 className="secretary-dashboard__section-title">תיבת בקשות</h2>

      <SecretaryRequestsFilters filters={filters} onFiltersChange={setFilters} />

      {isLoading && (
        <p className="secretary-dashboard__status">טוען בקשות...</p>
      )}

      {!isLoading && loadError && (
        <p className="secretary-dashboard__status secretary-dashboard__status--error">
          {loadError}
        </p>
      )}

      {!isLoading && !loadError && (
        <SecretaryRequestsTable
          requests={filteredRequests}
          emptyMessage={emptyMessage}
        />
      )}
    </section>
  )
}
