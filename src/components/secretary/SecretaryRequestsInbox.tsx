import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  RequestStatus,
  RequestStatusHistoryEntry,
  SecretaryInboxFilters,
  SecretaryInboxRequest,
} from '../../types/request'
import type { ReminderNavigationIntent } from '../../types/reminderNavigation'
import {
  archiveRequestAsSecretary,
  loadRequestStatusHistory,
  loadSecretaryRequests,
  updateRequestStatus,
} from '../../services/requests'
import { loadRequestAttachmentRequestIds } from '../../services/attachments'
import { loadInstitutionRequestReminderSummaries, subscribeToInstitutionRequestReminders, unsubscribeFromInstitutionRequestReminders, upsertReminderSummary } from '../../services/requestReminders'
import type { RequestReminderSummary } from '../../types/requestReminder'
import { filterSecretaryInboxRequests } from '../../utils/requests'
import { SECRETARY_INBOX_DEFAULT_FILTERS, shouldResetSecretaryInboxFilters } from '../../utils/reminderNavigation'
import { useRequestReminderNavigationEffect } from '../../hooks/useRequestReminderNavigationEffect'
import { NavInboxIcon } from '../dashboard/dashboardNav'
import { DashboardCollapsibleSection } from '../dashboard/DashboardCollapsibleSection'
import { RequestStatusHistoryPanel } from './RequestStatusHistoryPanel'
import { RequestNotesPanel } from './RequestNotesPanel'
import { SecretaryRequestsFilters } from './SecretaryRequestsFilters'
import { SecretaryRequestsTable } from './SecretaryRequestsTable'

const defaultFilters = SECRETARY_INBOX_DEFAULT_FILTERS

type SecretaryRequestsInboxProps = {
  onArchived: () => void
  institutionId?: string | null
  unreadReminderRequestIds?: ReadonlySet<string>
  reminderNavigationIntent?: ReminderNavigationIntent | null
  highlightedRequestId?: string | null
  onReminderNavigationComplete?: (token: number, found: boolean) => void
}

export function SecretaryRequestsInbox({
  onArchived,
  institutionId,
  unreadReminderRequestIds = new Set(),
  reminderNavigationIntent = null,
  highlightedRequestId = null,
  onReminderNavigationComplete,
}: SecretaryRequestsInboxProps) {
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
  const [archivingRequestId, setArchivingRequestId] = useState<string | null>(null)
  const [archiveDialogRequest, setArchiveDialogRequest] = useState<SecretaryInboxRequest | null>(
    null,
  )
  const [reminderSummariesByRequestId, setReminderSummariesByRequestId] = useState<
    Map<string, RequestReminderSummary>
  >(new Map())

  const fetchRequests = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const [requestsResult, attachmentIdsResult, remindersResult] = await Promise.all([
      loadSecretaryRequests(),
      loadRequestAttachmentRequestIds(),
      loadInstitutionRequestReminderSummaries(),
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

    if (remindersResult.ok) {
      setReminderSummariesByRequestId(
        new Map(remindersResult.summaries.map((summary) => [summary.request_id, summary])),
      )
    } else {
      setReminderSummariesByRequestId(new Map())
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchRequests()
    })
  }, [fetchRequests])

  useEffect(() => {
    if (unreadReminderRequestIds.size === 0) {
      return
    }

    async function refreshReminderSummaries() {
      const result = await loadInstitutionRequestReminderSummaries()
      if (result.ok) {
        setReminderSummariesByRequestId(
          new Map(result.summaries.map((summary) => [summary.request_id, summary])),
        )
      }
    }

    void refreshReminderSummaries()
  }, [unreadReminderRequestIds])

  useEffect(() => {
    if (!institutionId) {
      return
    }

    const channel = subscribeToInstitutionRequestReminders(institutionId, (summary) => {
      setReminderSummariesByRequestId((currentSummaries) => upsertReminderSummary(currentSummaries, summary))
    })

    return () => {
      void unsubscribeFromInstitutionRequestReminders(channel)
    }
  }, [institutionId])

  const filteredRequests = useMemo(
    () => filterSecretaryInboxRequests(requests, filters, requestIdsWithAttachments),
    [requests, filters, requestIdsWithAttachments],
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
      if (
        shouldResetSecretaryInboxFilters(filters, requestId, requests, filteredRequestIds)
      ) {
        setFilters(defaultFilters)
      }
    },
    [filters, requests, filteredRequestIds],
  )

  useRequestReminderNavigationEffect({
    intent: reminderNavigationIntent,
    expectedLocationKind: 'secretary_inbox',
    isReady: !isLoading && !loadError,
    isRequestInDataset: (requestId) => requests.some((request) => request.id === requestId),
    isRequestVisible: (requestId) => filteredRequestIds.has(requestId),
    revealRequest: revealReminderRequest,
    onComplete: handleReminderNavigationComplete,
  })

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

  function handleOpenArchiveDialog(request: SecretaryInboxRequest) {
    setStatusMessage('')
    setArchiveDialogRequest(request)
  }

  function handleCloseArchiveDialog() {
    if (archivingRequestId !== null) {
      return
    }
    setArchiveDialogRequest(null)
  }

  async function handleConfirmArchive() {
    if (!archiveDialogRequest || archivingRequestId !== null) {
      return
    }

    setStatusMessage('')
    setArchivingRequestId(archiveDialogRequest.id)

    const result = await archiveRequestAsSecretary(archiveDialogRequest.id)

    setArchivingRequestId(null)

    if (!result.ok) {
      setStatusMessage(result.errorMessage)
      setStatusMessageIsError(true)
      setArchiveDialogRequest(null)
      return
    }

    setRequests((currentRequests) =>
      currentRequests.filter((request) => request.id !== archiveDialogRequest.id),
    )
    setStatusMessage('הבקשה הועברה לארכיון המוסדי בהצלחה.')
    setStatusMessageIsError(false)
    setArchiveDialogRequest(null)
    onArchived()
  }

  return (
    <section className="ds-card secretary-dashboard__inbox">
      <DashboardCollapsibleSection
        title="תיבת בקשות"
        icon={<NavInboxIcon />}
        className="dashboard-collapsible-section--flush-header"
      >
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
            archivingRequestId={archivingRequestId}
            requestIdsWithAttachments={requestIdsWithAttachments}
            unreadReminderRequestIds={unreadReminderRequestIds}
            reminderSummariesByRequestId={reminderSummariesByRequestId}
            highlightedRequestId={highlightedRequestId}
            onStatusChange={handleStatusChange}
            onShowHistory={handleShowHistory}
            onShowNotes={handleShowNotes}
            onArchive={handleOpenArchiveDialog}
          />
        )}
      </DashboardCollapsibleSection>

      {archiveDialogRequest && (
        <div
          className="secretary-dashboard__archive-confirm-overlay"
          onClick={handleCloseArchiveDialog}
          role="presentation"
        >
          <div
            className="secretary-dashboard__archive-confirm-panel ds-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="secretary-archive-confirm-title"
          >
            <h3
              id="secretary-archive-confirm-title"
              className="secretary-dashboard__section-title"
            >
              להעביר לארכיון מוסדי?
            </h3>
            <p className="ds-form-message">
              הבקשה תוסר מתיבת הבקשות הפעילות ותופיע בארכיון המוסדי.
            </p>
            <div className="secretary-dashboard__archive-confirm-actions">
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                onClick={handleCloseArchiveDialog}
                disabled={archivingRequestId !== null}
              >
                ביטול
              </button>
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={handleConfirmArchive}
                disabled={archivingRequestId !== null}
              >
                {archivingRequestId !== null ? 'מעביר...' : 'כן, להעביר לארכיון'}
              </button>
            </div>
          </div>
        </div>
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
