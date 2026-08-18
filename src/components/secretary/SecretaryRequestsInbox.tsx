import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  canOrdinaryStatusUpdate,
  canShowHandlerStatusSelect,
  isEligibleHandlerRole,
} from '../../domain/requestOwnership'
import { useRequestReminderNavigationEffect } from '../../hooks/useRequestReminderNavigationEffect'
import { loadRequestAttachmentRequestIds } from '../../services/attachments'
import { claimRequest } from '../../services/requestOwnership'
import {
  archiveRequestAsSecretary,
  loadSecretaryRequests,
  updateRequestStatus,
} from '../../services/requests'
import {
  loadInstitutionRequestReminderSummaries,
  subscribeToInstitutionRequestReminders,
  unsubscribeFromInstitutionRequestReminders,
  upsertReminderSummary,
} from '../../services/requestReminders'
import type { DashboardRequestNavigationIntent } from '../../types/dashboardAnalytics'
import type { RequestDetailsSecretaryRequest } from '../../types/requestDetails'
import type { RequestStatus, SecretaryInboxFilters, SecretaryInboxRequest } from '../../types/request'
import type { ReminderNavigationIntent } from '../../types/reminderNavigation'
import type { RequestReminderSummary } from '../../types/requestReminder'
import {
  isRequestOwnershipConflictCode,
  type RequestHandlerAssignedPatch,
} from '../../types/requestOwnership'
import type { PrimaryRole } from '../../types/user'
import { SECRETARY_INBOX_DEFAULT_FILTERS, shouldResetSecretaryInboxFilters } from '../../utils/reminderNavigation'
import { filterSecretaryInboxRequests, REQUEST_STATUS_OPTIONS } from '../../utils/requests'
import { NavInboxIcon } from '../dashboard/dashboardNav'
import { DashboardSection } from '../dashboard/DashboardSection'
import { RequestDetailsModal } from '../requests/RequestDetailsModal'
import { ConfirmDialog } from '../ui/Modal'
import { SecretaryRequestsFilters } from './SecretaryRequestsFilters'
import { SecretaryRequestsTable } from './SecretaryRequestsTable'

const defaultFilters = SECRETARY_INBOX_DEFAULT_FILTERS

type SecretaryRequestsInboxProps = {
  onArchived: () => void
  actorUserId: string
  actorRole?: PrimaryRole
  actorFullName: string
  institutionId?: string | null
  unreadReminderRequestIds?: ReadonlySet<string>
  unreadMessageRequestIds?: ReadonlySet<string>
  requestIdsWithMessages?: ReadonlySet<string>
  onConversationOpened?: (requestId: string) => void | Promise<boolean>
  reminderNavigationIntent?: ReminderNavigationIntent | null
  highlightedRequestId?: string | null
  onReminderNavigationComplete?: (token: number, found: boolean) => void
  requestNavigationIntent?: DashboardRequestNavigationIntent | null
  onRequestNavigationIntentConsumed?: () => void
}

export function SecretaryRequestsInbox({
  onArchived,
  actorUserId,
  actorRole = 'secretary',
  actorFullName,
  institutionId,
  unreadReminderRequestIds = new Set(),
  unreadMessageRequestIds = new Set(),
  requestIdsWithMessages = new Set(),
  onConversationOpened,
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

    if (
      !canShowHandlerStatusSelect({
        actorUserId,
        handledByUserId: currentRequest.handled_by_user_id,
      }) ||
      !canOrdinaryStatusUpdate({
        actorUserId,
        handledByUserId: currentRequest.handled_by_user_id,
        currentStatus: currentRequest.status,
        nextStatus: status,
      })
    ) {
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

  function applyAssignmentPatch(patch: RequestHandlerAssignedPatch) {
    const assignment = {
      handled_by_user_id: patch.handledByUserId,
      handled_by_full_name: patch.handledByFullName,
      handled_by_primary_role: patch.handledByPrimaryRole,
      status: patch.status,
    }
    setRequests((currentRequests) =>
      currentRequests.map((request) =>
        request.id === patch.requestId ? { ...request, ...assignment } : request,
      ),
    )
    setDetailsRequest((current) =>
      current?.id === patch.requestId ? { ...current, ...assignment } : current,
    )
  }

  async function handleOwnershipError(message: string, errorCode?: string) {
    setStatusMessage(message)
    setStatusMessageIsError(true)
    if (isRequestOwnershipConflictCode(errorCode)) {
      await fetchRequests()
    }
  }

  async function handleClaim(requestId: string) {
    setStatusMessage('')
    setUpdatingRequestId(requestId)
    const result = await claimRequest(requestId)
    setUpdatingRequestId(null)

    if (!result.ok) {
      await handleOwnershipError(result.errorMessage, result.errorCode)
      return
    }

    applyAssignmentPatch({
      requestId,
      handledByUserId: result.handledByUserId,
      handledByFullName: actorFullName,
      handledByPrimaryRole: isEligibleHandlerRole(actorRole) ? actorRole : 'secretary',
      status: result.status,
    })
    setStatusMessage('הבקשה נלקחה לטיפול.')
    setStatusMessageIsError(false)
  }

  function handleHandlerAssigned(patch: RequestHandlerAssignedPatch) {
    applyAssignmentPatch(patch)
    setStatusMessage('הטיפול הועבר בהצלחה.')
    setStatusMessageIsError(false)
  }

  function handleHandlerReleased(requestId: string, status: RequestStatus) {
    const assignment = {
      handled_by_user_id: null,
      handled_by_full_name: null,
      handled_by_primary_role: null,
      status,
    }
    setRequests((currentRequests) =>
      currentRequests.map((request) =>
        request.id === requestId ? { ...request, ...assignment } : request,
      ),
    )
    setDetailsRequest((current) =>
      current?.id === requestId ? { ...current, ...assignment } : current,
    )
    setStatusMessage('הטיפול שוחרר.')
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
            actorUserId={actorUserId}
            actorRole={actorRole}
            institutionId={institutionId}
            emptyMessage={emptyMessage}
            updatingRequestId={updatingRequestId}
            archivingRequestId={archivingRequestId}
            requestIdsWithAttachments={requestIdsWithAttachments}
            unreadReminderRequestIds={unreadReminderRequestIds}
            unreadMessageRequestIds={unreadMessageRequestIds}
            requestIdsWithMessages={requestIdsWithMessages}
            reminderSummariesByRequestId={reminderSummariesByRequestId}
            highlightedRequestId={highlightedRequestId}
            onStatusChange={handleStatusChange}
            onOpenDetails={handleOpenDetails}
            onArchive={handleOpenArchiveDialog}
            onClaim={(requestId) => void handleClaim(requestId)}
            onHandlerAssigned={handleHandlerAssigned}
            onHandlerReleased={handleHandlerReleased}
            onHandlerError={(message, errorCode) => {
              void handleOwnershipError(message, errorCode)
            }}
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
          onConversationOpened={() => void onConversationOpened?.(detailsRequest.id)}
          showHistory
          showNotes
          ownership={{
            actorUserId,
            actorRole,
            institutionId,
            isBusy: updatingRequestId === detailsRequest.id || archivingRequestId !== null,
            onClaim: (requestId) => void handleClaim(requestId),
            onAssigned: handleHandlerAssigned,
            onReleased: handleHandlerReleased,
            onError: (message, errorCode) => {
              void handleOwnershipError(message, errorCode)
            },
          }}
          onClose={handleCloseDetails}
          actions={
            <>
              {canShowHandlerStatusSelect({
                actorUserId,
                handledByUserId: detailsRequest.handled_by_user_id,
              }) ? (
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
                  {REQUEST_STATUS_OPTIONS.filter(
                    (option) => option.value !== 'in_progress' || detailsRequest.status !== 'new',
                  ).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              ) : null}
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
