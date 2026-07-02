import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  RequestStatus,
  SecretaryInboxFilters,
  SecretaryInboxRequest,
} from '../../types/request'
import { loadSecretaryRequests, updateRequestStatus } from '../../services/requests'
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
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [statusMessageIsError, setStatusMessageIsError] = useState(false)

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

  async function handleStatusChange(requestId: string, status: RequestStatus) {
    const currentRequest = requests.find((request) => request.id === requestId)
    if (!currentRequest || currentRequest.status === status) {
      return
    }

    setStatusMessage('')
    setUpdatingRequestId(requestId)

    const result = await updateRequestStatus(requestId, status)

    setUpdatingRequestId(null)

    if (!result.ok) {
      setStatusMessage(result.errorMessage)
      setStatusMessageIsError(true)
      return
    }

    setRequests((currentRequests) =>
      currentRequests.map((request) =>
        request.id === requestId ? { ...request, status } : request,
      ),
    )
    setStatusMessage('סטטוס הבקשה עודכן בהצלחה.')
    setStatusMessageIsError(false)
  }

  return (
    <section className="secretary-dashboard__inbox">
      <h2 className="secretary-dashboard__section-title">תיבת בקשות</h2>

      <SecretaryRequestsFilters filters={filters} onFiltersChange={setFilters} />

      {statusMessage && (
        <p
          className={
            statusMessageIsError
              ? 'secretary-dashboard__status secretary-dashboard__status--error'
              : 'secretary-dashboard__status secretary-dashboard__status--success'
          }
        >
          {statusMessage}
        </p>
      )}

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
          updatingRequestId={updatingRequestId}
          onStatusChange={handleStatusChange}
        />
      )}
    </section>
  )
}
