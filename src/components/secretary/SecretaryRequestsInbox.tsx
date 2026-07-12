import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RequestStatus, SecretaryInboxFilters, SecretaryInboxRequest } from '../../types/request'
import type { DashboardRequestNavigationIntent } from '../../types/dashboardAnalytics'
import type { ReminderNavigationIntent } from '../../types/reminderNavigation'
import {
  archiveRequestAsSecretary,
  loadSecretaryRequests,
  updateRequestStatus,
} from '../../services/requests'
import { loadRequestAttachmentRequestIds } from '../../services/attachments'
import { loadInstitutionRequestReminderSummaries, subscribeToInstitutionRequestReminders, unsubscribeFromInstitutionRequestReminders, upsertReminderSummary } from '../../services/requestReminders'
import type { RequestReminderSummary } from '../../types/requestReminder'
import { filterSecretaryInboxRequests, REQUEST_STATUS_OPTIONS } from '../../utils/requests'
import type { RequestDetailsSecretaryRequest } from '../../types/requestDetails'
import { RequestDetailsModal } from '../requests/RequestDetailsModal'
import { SECRETARY_INBOX_DEFAULT_FILTERS, shouldResetSecretaryInboxFilters } from '../../utils/reminderNavigation'
import { useRequestReminderNavigationEffect } from '../../hooks/useRequestReminderNavigationEffect'
import { NavInboxIcon } from '../dashboard/dashboardNav'
import { DashboardSection } from '../dashboard/DashboardSection'
import { ConfirmDialog } from '../ui/Modal'
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
  requestNavigationIntent?: DashboardRequestNavigationIntent | null
  onRequestNavigationIntentConsumed?: () => void
}

export function SecretaryRequestsInbox({
  onArchived,
  institutionId,
  unreadReminderRequestIds = new Set(),
  reminderNavigationIntent = null,
  highlightedRequestId = null,
  onReminderNavigationComplete,
  requestNavigationIntent = null,
  onRequestNavigationIntentConsumed,
}: SecretaryRequestsInboxProps) {
  const [requests, setRequests] = useState<SecretaryInboxRequest[]>([])
  const [filters, setFilters] = useState<SecretaryInboxFilters>(defaultFilters)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [statusMessageIsError, setStatusMessageIsError] = useState(false)
  const [requestIdsWithAttachments, setRequestIdsWithAttachments] = useState<
    ReadonlySet<string>
  >(new Set())
  const [detailsRequest, setDetailsRequest] = useState<RequestDetailsSecretaryRequest | null>(null)
  const [detailsReturnFocusElement, setDetailsReturnFocusElement] = useState<HTMLElement | null>(
    null,
  )
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

  useEffect(() => {
    if (!requestNavigationIntent) {
      return
    }

    queueMicrotask(() => {
      setFilters((currentFilters) => ({
        ...currentFilters,
        requestStatus: requestNavigationIntent.requestStatus ?? currentFilters.requestStatus,
        requestType: requestNavigationIntent.requestType ?? currentFilters.requestType,
      }))
      onRequestNavigationIntentConsumed?.()
    })
  }, [requestNavigationIntent, onRequestNavigationIntentConsumed])

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
    setDetailsRequest((current) =>
      current?.id === requestId ? { ...current, status } : current,
    )
    setStatusMessage('סטטוס הבקשה עודכן בהצלחה.')
    setStatusMessageIsError(false)
  }

  function handleOpenDetails(request: SecretaryInboxRequest, rowElement: HTMLTableRowElement) {
    setDetailsReturnFocusElement(rowElement)
    setDetailsRequest({ ...request, role: 'secretary' })
  }

  function handleCloseDetails() {
    setDetailsRequest(null)
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
    setDetailsRequest((current) =>
      current?.id === archiveDialogRequest.id ? null : current,
    )
    onArchived()
  }

  return (
    <section className="ds-card secretary-dashboard__inbox">
      <DashboardSection
        title="תיבת בקשות"
        icon={<NavInboxIcon />}
        className="dashboard-section--flush-header"
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
            onOpenDetails={handleOpenDetails}
            onArchive={handleOpenArchiveDialog}
          />
        )}
      </DashboardSection>

      {archiveDialogRequest && (
        <ConfirmDialog
          isOpen
          title="להעביר לארכיון מוסדי?"
          message="הבקשה תוסר מתיבת הבקשות הפעילות ותופיע בארכיון המוסדי."
          continueLabel="ביטול"
          confirmLabel={archivingRequestId !== null ? 'מעביר...' : 'כן, להעביר לארכיון'}
          closeOnBackdropClick
          continueDisabled={archivingRequestId !== null}
          confirmDisabled={archivingRequestId !== null}
          onContinue={handleCloseArchiveDialog}
          onConfirm={handleConfirmArchive}
        />
      )}

      {detailsRequest && (
        <RequestDetailsModal
          isOpen
          request={detailsRequest}
          returnFocusElement={detailsReturnFocusElement}
          hasAttachment={requestIdsWithAttachments.has(detailsRequest.id)}
          reminderSummary={reminderSummariesByRequestId.get(detailsRequest.id)}
          hasUnreadReminder={unreadReminderRequestIds.has(detailsRequest.id)}
          showHistory
          showNotes
          onClose={handleCloseDetails}
          actions={
            <>
              <label className="request-details__status-field">
                <span className="ds-label">עדכון סטטוס</span>
                <select
                  className="secretary-dashboard__input secretary-dashboard__status-select"
                  value={detailsRequest.status}
                  onChange={(event) =>
                    void handleStatusChange(
                      detailsRequest.id,
                      event.target.value as RequestStatus,
                    )
                  }
                  disabled={updatingRequestId === detailsRequest.id || archivingRequestId !== null}
                >
                  {REQUEST_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {(detailsRequest.status === 'completed' || detailsRequest.status === 'rejected') && (
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => handleOpenArchiveDialog(detailsRequest)}
                  disabled={archivingRequestId !== null}
                >
                  {archivingRequestId === detailsRequest.id ? 'מעביר...' : 'העבר לארכיון'}
                </button>
              )}
            </>
          }
        />
      )}
    </section>
  )
}
