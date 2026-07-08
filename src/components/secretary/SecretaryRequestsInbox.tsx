import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  RequestStatus,
  RequestStatusHistoryEntry,
  SecretaryInboxFilters,
  SecretaryInboxRequest,
} from '../../types/request'
import {
  loadRequestStatusHistory,
  loadSecretaryRequests,
  updateRequestStatus,
} from '../../services/requests'
import { loadRequestAttachmentRequestIds } from '../../services/attachments'
import { filterSecretaryInboxRequests } from '../../utils/requests'
import { NavInboxIcon } from '../dashboard/dashboardNav'
import { RequestStatusHistoryPanel } from './RequestStatusHistoryPanel'
import { RequestNotesPanel } from './RequestNotesPanel'
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
  const [historyRequestId, setHistoryRequestId] = useState<string | null>(null)
  const [historyEntries, setHistoryEntries] = useState<RequestStatusHistoryEntry[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [requestIdsWithAttachments, setRequestIdsWithAttachments] = useState<
    ReadonlySet<string>
  >(new Set())
  const [notesRequestId, setNotesRequestId] = useState<string | null>(null)

  const fetchRequests = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const [requestsResult, attachmentIdsResult] = await Promise.all([
      loadSecretaryRequests(),
      loadRequestAttachmentRequestIds(),
    ])

    if (!requestsResult.ok) {
      setRequests([])
      setLoadError(requestsResult.errorMessage)
    } else {
      setRequests(requestsResult.requests)
    }

    if (attachmentIdsResult.ok) {
      setRequestIdsWithAttachments(attachmentIdsResult.requestIds)
    } else {
      setRequestIdsWithAttachments(new Set())
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchRequests()
    })
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

  function handleCloseHistory() {
    setHistoryRequestId(null)
    setHistoryEntries([])
    setHistoryError('')
    setIsHistoryLoading(false)
  }

  async function handleShowHistory(requestId: string) {
    setHistoryRequestId(requestId)
    setHistoryEntries([])
    setHistoryError('')
    setIsHistoryLoading(true)

    const result = await loadRequestStatusHistory(requestId)

    setIsHistoryLoading(false)

    if (!result.ok) {
      setHistoryError(result.errorMessage)
      return
    }

    setHistoryEntries(result.entries)
  }

  function handleCloseNotes() {
    setNotesRequestId(null)
  }

  function handleShowNotes(requestId: string) {
    setNotesRequestId(requestId)
  }

  return (
    <section className="ds-card secretary-dashboard__inbox">
      <h2 className="secretary-dashboard__section-title">
        <span className="dashboard-card__title-icon" aria-hidden="true">
          <NavInboxIcon />
        </span>
        תיבת בקשות
      </h2>

      <SecretaryRequestsFilters filters={filters} onFiltersChange={setFilters} />

      {statusMessage && (
        <p
          className={
            statusMessageIsError
              ? 'ds-form-message ds-form-message--error'
              : 'ds-form-message ds-form-message--success'
          }
        >
          {statusMessage}
        </p>
      )}

      {isLoading && <p className="ds-form-message">טוען בקשות...</p>}

      {!isLoading && loadError && (
        <p className="ds-form-message ds-form-message--error">{loadError}</p>
      )}

      {!isLoading && !loadError && (
        <SecretaryRequestsTable
          requests={filteredRequests}
          emptyMessage={emptyMessage}
          updatingRequestId={updatingRequestId}
          requestIdsWithAttachments={requestIdsWithAttachments}
          onStatusChange={handleStatusChange}
          onShowHistory={handleShowHistory}
          onShowNotes={handleShowNotes}
        />
      )}

      <RequestStatusHistoryPanel
        isOpen={historyRequestId !== null}
        isLoading={isHistoryLoading}
        errorMessage={historyError}
        entries={historyEntries}
        onClose={handleCloseHistory}
      />

      <RequestNotesPanel
        isOpen={notesRequestId !== null}
        requestId={notesRequestId}
        onClose={handleCloseNotes}
      />
    </section>
  )
}
